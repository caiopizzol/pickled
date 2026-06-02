import { Glob } from "bun";
import { runProcess, type Workspace, type WorkspaceDiff } from "./workspace.js";

/**
 * Deterministic verifiers for implement-mode tasks. The agent edits the
 * workspace; these grade the result by command exit codes and the captured
 * diff. No LLM grades another LLM.
 */

export interface CommandSpec {
  name: string;
  run: string;
}

export interface CommandResult {
  name: string;
  run: string;
  exitCode: number;
  passed: boolean;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/**
 * Run each command in the workspace. A command passes on exit 0. These are the
 * agent's verdict inputs (tests, typecheck, build), distinct from `setup`,
 * whose failure is an environment error rather than an agent failure.
 */
export async function runCommands(
  ws: Workspace,
  commands: CommandSpec[],
  opts: { timeoutMs?: number } = {},
): Promise<CommandResult[]> {
  const results: CommandResult[] = [];
  for (const { name, run } of commands) {
    const r = await runProcess(["sh", "-c", run], {
      cwd: ws.dir,
      timeoutMs: opts.timeoutMs,
    });
    results.push({
      name,
      run,
      exitCode: r.exitCode,
      passed: r.exitCode === 0,
      stdout: r.stdout,
      stderr: r.stderr,
      timedOut: r.timedOut,
    });
  }
  return results;
}

export interface DiffChecks {
  /** Each glob must match at least one changed file. */
  mustChange?: string[];
  /** No changed file may match any of these globs. */
  mustNotChange?: string[];
  /** Each substring must appear in the lines the agent added. */
  mustContain?: string[];
  /** No substring may appear in the lines the agent added. */
  mustNotContain?: string[];
}

export interface DiffCheckResult {
  kind: "mustChange" | "mustNotChange" | "mustContain" | "mustNotContain";
  target: string;
  satisfied: boolean;
}

/** Lines the agent added (unified-diff `+` lines, excluding the `+++` header). */
function addedContent(diff: string): string {
  return diff
    .split("\n")
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
    .map((line) => line.slice(1))
    .join("\n");
}

/**
 * Grade the captured diff against the declared checks. Globs match changed
 * file paths; `mustContain` / `mustNotContain` match only the agent's added
 * lines, so pre-existing fixture content can neither satisfy nor fail them.
 */
export function checkDiff(
  diff: WorkspaceDiff,
  checks: DiffChecks,
): DiffCheckResult[] {
  const results: DiffCheckResult[] = [];
  const paths = diff.changedFiles.map((f) => f.path);
  const added = addedContent(diff.diff);

  for (const pattern of checks.mustChange ?? []) {
    const glob = new Glob(pattern);
    results.push({
      kind: "mustChange",
      target: pattern,
      satisfied: paths.some((p) => glob.match(p)),
    });
  }
  for (const pattern of checks.mustNotChange ?? []) {
    const glob = new Glob(pattern);
    results.push({
      kind: "mustNotChange",
      target: pattern,
      satisfied: !paths.some((p) => glob.match(p)),
    });
  }
  for (const needle of checks.mustContain ?? []) {
    results.push({
      kind: "mustContain",
      target: needle,
      satisfied: added.includes(needle),
    });
  }
  for (const needle of checks.mustNotContain ?? []) {
    results.push({
      kind: "mustNotContain",
      target: needle,
      satisfied: !added.includes(needle),
    });
  }
  return results;
}
