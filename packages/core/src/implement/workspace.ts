import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Implement-mode execution primitives. An implementation task copies a fixture
 * into a throwaway workspace, the agent edits it, and deterministic verifiers
 * grade the result (no LLM grading). This module owns the workspace lifecycle:
 * copy -> setup -> baseline -> (agent edits) -> capture diff -> cleanup.
 *
 * Not wired to the public schema or any CLI command yet; the runner that
 * orchestrates these primitives lands with the `tasks` / `kind` schema.
 */

export interface ProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  /** True when the process was killed by the timeout rather than exiting. */
  timedOut: boolean;
}

const TIMEOUT_EXIT = 124;

/**
 * Run a process to completion in `cwd`, capturing stdout/stderr. A non-zero
 * `timeoutMs` kills the process after that long and reports `timedOut`.
 */
export async function runProcess(
  cmd: string[],
  opts: { cwd: string; timeoutMs?: number },
): Promise<ProcessResult> {
  const proc = Bun.spawn(cmd, {
    cwd: opts.cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  // Drain the pipes from the start so a chatty process never deadlocks on a
  // full pipe buffer.
  const stdoutP = new Response(proc.stdout).text();
  const stderrP = new Response(proc.stderr).text();

  let timedOut = false;
  if (opts.timeoutMs && opts.timeoutMs > 0) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), opts.timeoutMs);
    });
    const outcome = await Promise.race([
      proc.exited.then(() => "exited" as const),
      timeout,
    ]);
    if (timer) clearTimeout(timer);
    if (outcome === "timeout") {
      timedOut = true;
      proc.kill();
    }
  } else {
    await proc.exited;
  }

  // A killed process can leave a grandchild (e.g. `sh -c "sleep"`) holding the
  // pipe open, so cap the drain on timeout; otherwise the read blocks until the
  // grandchild exits. Normal exits drain instantly.
  const drain = (p: Promise<string>): Promise<string> =>
    timedOut
      ? Promise.race([
          p,
          new Promise<string>((resolve) => {
            setTimeout(() => resolve(""), 200);
          }),
        ])
      : p;
  const [stdout, stderr] = await Promise.all([drain(stdoutP), drain(stderrP)]);
  const exitCode = timedOut ? TIMEOUT_EXIT : await proc.exited;
  return { exitCode, stdout, stderr, timedOut };
}

export interface Workspace {
  /** Absolute path to the throwaway working directory. */
  dir: string;
  /** The fixture this workspace was copied from. */
  fixture: string;
}

/**
 * Thrown when a `setup` command fails. Distinct from a verifier failure so the
 * runner scores the cell as `Error` (environment failure), never as the agent
 * failing the task. See implement-mode-plan.md decision 5.
 */
export class SetupError extends Error {
  readonly result: ProcessResult;
  readonly command: string;
  constructor(command: string, result: ProcessResult) {
    super(
      `setup command failed (exit ${result.exitCode}): ${command}\n${result.stderr.trim() || result.stdout.trim()}`,
    );
    this.name = "SetupError";
    this.command = command;
    this.result = result;
  }
}

async function git(dir: string, args: string[]): Promise<ProcessResult> {
  // -c flags give a commit identity without depending on global git config
  // (CI runners often have none) and skip signing.
  const identity = [
    "-c",
    "user.email=pickled@example.invalid",
    "-c",
    "user.name=pickled",
    "-c",
    "commit.gpgsign=false",
  ];
  return runProcess(["git", ...identity, ...args], { cwd: dir });
}

/** Run a git command and throw with context on a non-zero exit. */
async function gitOrThrow(
  dir: string,
  args: string[],
  what: string,
): Promise<ProcessResult> {
  const result = await git(dir, args);
  if (result.exitCode !== 0) {
    throw new Error(
      `workspace: ${what} failed (exit ${result.exitCode}): ${result.stderr.trim() || result.stdout.trim()}`,
    );
  }
  return result;
}

/**
 * Copy `fixturePath` into a fresh temp dir and initialize a clean git repo
 * there (any copied `.git` is discarded). The repo is the mechanism for diff
 * capture; `captureDiff` reports changes against the baseline.
 */
export async function createWorkspace(fixturePath: string): Promise<Workspace> {
  const dir = await mkdtemp(join(tmpdir(), "pickled-ws-"));
  await cp(fixturePath, dir, { recursive: true });
  await rm(join(dir, ".git"), { recursive: true, force: true });
  await gitOrThrow(dir, ["init", "-q"], "git init");
  return { dir, fixture: fixturePath };
}

/**
 * Run each setup command in order. Throws `SetupError` on the first non-zero
 * exit so the caller can quarantine the cell as `Error`. Run before
 * `baselineWorkspace` so setup output (deps, build artifacts) lands in the
 * baseline and never in the agent's diff.
 */
export async function runSetup(
  ws: Workspace,
  commands: string[],
  opts: { timeoutMs?: number } = {},
): Promise<void> {
  for (const command of commands) {
    const result = await runProcess(["sh", "-c", command], {
      cwd: ws.dir,
      timeoutMs: opts.timeoutMs,
    });
    if (result.exitCode !== 0) {
      throw new SetupError(command, result);
    }
  }
}

/**
 * Commit the current workspace state as the baseline. Files ignored by the
 * fixture's `.gitignore` (node_modules, build output) stay out of the baseline
 * and out of every later diff. Call after `runSetup`, before the agent runs.
 */
export async function baselineWorkspace(ws: Workspace): Promise<void> {
  await gitOrThrow(ws.dir, ["add", "-A"], "git add (baseline)");
  await gitOrThrow(
    ws.dir,
    ["commit", "-q", "--no-gpg-sign", "--allow-empty", "-m", "baseline"],
    "baseline commit",
  );
}

export interface ChangedFile {
  /** Single-letter git status: A added, M modified, D deleted, R renamed. */
  status: string;
  /** New path (the destination for renames and copies). */
  path: string;
  /** Original path, present only for renames and copies. */
  oldPath?: string;
}

export interface WorkspaceDiff {
  /** Files the agent changed relative to the baseline. */
  changedFiles: ChangedFile[];
  /** Unified diff against the baseline. Empty string when nothing changed. */
  diff: string;
}

/**
 * Parse `git diff --name-status -M` output. Git tab-delimits the fields and
 * emits `R<score>\told\tnew` for renames (`C<score>` for copies), so split on
 * tab, normalize the status to its leading letter, and take the new path.
 */
export function parseNameStatus(stdout: string): ChangedFile[] {
  return stdout
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => {
      const parts = line.split("\t");
      const status = (parts[0] ?? "").charAt(0);
      if (parts.length >= 3) {
        return { status, path: parts[2] ?? "", oldPath: parts[1] };
      }
      return { status, path: parts[1] ?? "" };
    });
}

/**
 * Capture what changed since `baselineWorkspace`. An empty `changedFiles` means
 * the agent did nothing relevant; the runner hard-vetoes that cell to NO. Git
 * failures throw (environment error) rather than masquerading as an empty diff.
 */
export async function captureDiff(ws: Workspace): Promise<WorkspaceDiff> {
  await gitOrThrow(ws.dir, ["add", "-A"], "git add (diff)");
  const nameStatus = await gitOrThrow(
    ws.dir,
    ["diff", "--cached", "-M", "--name-status", "HEAD"],
    "git diff --name-status",
  );
  const diff = await gitOrThrow(
    ws.dir,
    ["diff", "--cached", "-M", "HEAD"],
    "git diff",
  );
  return {
    changedFiles: parseNameStatus(nameStatus.stdout),
    diff: diff.stdout,
  };
}

/**
 * Remove the workspace. When `keepOnFailure` is set and the cell failed, the
 * directory is left in place and its path returned so a human can inspect it.
 */
export async function cleanupWorkspace(
  ws: Workspace,
  opts: { keepOnFailure?: boolean; failed?: boolean } = {},
): Promise<{ kept: boolean; dir: string }> {
  if (opts.keepOnFailure && opts.failed) {
    return { kept: true, dir: ws.dir };
  }
  await rm(ws.dir, { recursive: true, force: true });
  return { kept: false, dir: ws.dir };
}
