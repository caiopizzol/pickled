import { isAbsolute, resolve } from "node:path";
import type {
  Build,
  Config,
  ResolvedSource,
  Target,
} from "@pickled-dev/config";
import { Glob } from "bun";
import { resolveCellRuntime } from "../cell-runtime.js";
import { assertEditCapable, createTarget } from "../targets/index.js";
import type { TargetRunner } from "../targets/types.js";
import type {
  BuildAttempt,
  BuildCell,
  CellCoord,
  CommandReceipt,
  ToolInfo,
  VerifierGroup,
  VerifierProof,
} from "../types.js";
import { type CommandSpec, runCommands } from "./verifiers.js";
import {
  baselineWorkspace,
  captureDiff,
  cleanupWorkspace,
  createWorkspace,
  runProcess,
  runSetup,
  SetupError,
  type Workspace,
} from "./workspace.js";

/** Internal timeouts so a hung agent or verify command cannot stall CI. */
const AGENT_TIMEOUT_MS = 600_000;
const VERIFY_TIMEOUT_MS = 300_000;
const SETUP_TIMEOUT_MS = 600_000;

/** Baseline files the agent must not weaken to pass. Test files only in v1. */
const HARNESS_GLOBS = ["**/*.test.*", "**/*.spec.*", "tests/**", "test/**"];

interface BuildTask {
  goal: string;
  workspacePath: string;
  setup: string[];
  failToPass: CommandSpec[];
  passToPass: CommandSpec[];
  trials: number;
  referenceSolutionPatch?: string;
}

export interface BuildRunOptions {
  tool: ToolInfo;
  targetFactory?: (name: string, config: Target) => TargetRunner;
  keepOnFailure?: boolean;
  agentTimeoutMs?: number;
  onProgress?: (msg: string) => void;
}

function contextSource(
  context: { mode: string; source?: string } | undefined,
): string | null {
  if (!context || context.mode === "memory") return null;
  return context.source ?? null;
}

/**
 * Run one build cell (agent x context): a SWE-bench-style preflight (the
 * untouched fixture must FAIL every failToPass and PASS every passToPass), an
 * optional reference-solution control, then `trials` independent trials in
 * fresh workspaces. Returns a BuildCell with the strict k/n verdict, or an
 * error cell (setup failure, vacuous/broken fixture, all trials errored).
 */
export async function runBuildCell(args: {
  build: Build;
  agent: string;
  contextName: string;
  config: Config;
  sources: ResolvedSource[];
  options: BuildRunOptions;
}): Promise<BuildCell> {
  const { build, agent, contextName, config, sources, options } = args;
  const coord: CellCoord = { agent, context: contextName };
  const context = config.contexts[contextName];
  const mode = (context?.mode ?? "memory") as BuildCell["mode"];
  const source = contextSource(context);

  if (!context) {
    return errorCell(coord, mode, source, `unknown context "${contextName}"`);
  }

  let rt: ReturnType<typeof resolveCellRuntime>;
  try {
    rt = resolveCellRuntime({ agent, context, config, sources, kind: "build" });
    assertEditCapable(agent, rt.target);
  } catch (e) {
    return errorCell(coord, mode, source, errMsg(e));
  }

  const task: BuildTask = {
    goal: build.goal,
    workspacePath: build.workspace.path,
    setup: build.workspace.setup,
    failToPass: build.verifier.failToPass.map((c) => ({
      name: c.name,
      run: c.run,
    })),
    passToPass: build.verifier.passToPass.map((c) => ({
      name: c.name,
      run: c.run,
    })),
    trials: build.trials,
    referenceSolutionPatch: build.referenceSolution?.patch,
  };

  const preflight = await runPreflight(task);
  if (preflight.kind === "setup-error") {
    return errorCell(coord, mode, source, `setup failed: ${preflight.message}`);
  }
  if (preflight.kind === "invalid-fixture") {
    return errorCell(coord, mode, source, preflight.message);
  }

  const verifierProof = await runReferenceControl(task, options.tool.path);
  if (verifierProof === "failed") {
    return errorCell(
      coord,
      mode,
      source,
      "reference solution did not pass the verifier: the bar is unreachable or the verifier is broken; not scoring the agent",
      "failed",
    );
  }

  const attempts: BuildAttempt[] = [];
  for (let i = 0; i < task.trials; i++) {
    options.onProgress?.(`    trial ${i + 1}/${task.trials}`);
    attempts.push(await runTrial(task, rt, agent, options));
  }

  const scored = attempts.filter((a) => a.status !== "error");
  const passedAttempts = scored.filter((a) => a.status === "passed").length;
  const totalAttempts = scored.length;

  if (totalAttempts === 0) {
    const reasons = attempts
      .map((a) => a.reason)
      .filter(Boolean)
      .join("; ");
    return errorCell(
      coord,
      mode,
      source,
      `could not measure: all ${attempts.length} trial(s) errored${reasons ? ` (${reasons})` : ""}`,
      verifierProof,
    );
  }

  const verdict =
    passedAttempts === totalAttempts
      ? "YES"
      : passedAttempts === 0
        ? "NO"
        : "PARTIAL";
  const passRate = Math.round((passedAttempts / totalAttempts) * 100);

  return {
    coord,
    mode,
    source,
    verdict,
    passedAttempts,
    totalAttempts,
    passRate,
    attempts,
    reason: `Built ${passedAttempts}/${totalAttempts}`,
    verifierProof,
  };
}

type PreflightResult =
  | { kind: "setup-error"; message: string }
  | { kind: "invalid-fixture"; message: string }
  | { kind: "ok" };

/**
 * The untouched fixture must FAIL every failToPass (the task is real) and PASS
 * every passToPass (no pre-existing breakage). Either violation is a fixture
 * error, never scored as the agent failing.
 */
async function runPreflight(task: BuildTask): Promise<PreflightResult> {
  const ws = await createWorkspace(task.workspacePath);
  try {
    try {
      await runSetup(ws, task.setup, { timeoutMs: SETUP_TIMEOUT_MS });
    } catch (e) {
      if (e instanceof SetupError) {
        return { kind: "setup-error", message: e.command };
      }
      throw e;
    }
    const fail = await runCommands(ws, task.failToPass, {
      timeoutMs: VERIFY_TIMEOUT_MS,
    });
    const unexpectedlyPass = fail.filter((r) => r.passed).map((r) => r.name);
    if (unexpectedlyPass.length > 0) {
      return {
        kind: "invalid-fixture",
        message: `invalid fixture: failToPass already passes on the untouched workspace (${unexpectedlyPass.join(", ")}), so the task measures nothing`,
      };
    }
    const pass = await runCommands(ws, task.passToPass, {
      timeoutMs: VERIFY_TIMEOUT_MS,
    });
    const brokenBaseline = pass.filter((r) => !r.passed).map((r) => r.name);
    if (brokenBaseline.length > 0) {
      return {
        kind: "invalid-fixture",
        message: `invalid fixture: passToPass fails on the untouched workspace (${brokenBaseline.join(", ")}); the regression guard must be green before the agent`,
      };
    }
    return { kind: "ok" };
  } finally {
    await cleanupWorkspace(ws);
  }
}

/**
 * Optional positive control. Apply the reference patch to a fresh baseline and
 * run the full verifier: all failToPass + passToPass must pass, proving the bar
 * is reachable. Returns "passed" / "failed" / "not_declared".
 */
async function runReferenceControl(
  task: BuildTask,
  projectPath: string,
): Promise<VerifierProof> {
  if (!task.referenceSolutionPatch) return "not_declared";
  const patchAbs = isAbsolute(task.referenceSolutionPatch)
    ? task.referenceSolutionPatch
    : resolve(projectPath, task.referenceSolutionPatch);
  const ws = await createWorkspace(task.workspacePath);
  try {
    try {
      await runSetup(ws, task.setup, { timeoutMs: SETUP_TIMEOUT_MS });
    } catch {
      return "failed";
    }
    await baselineWorkspace(ws);
    const applied = await runProcess(["git", "apply", patchAbs], {
      cwd: ws.dir,
    });
    if (applied.exitCode !== 0) return "failed";
    const all = [...task.failToPass, ...task.passToPass];
    const results = await runCommands(ws, all, {
      timeoutMs: VERIFY_TIMEOUT_MS,
    });
    return results.every((r) => r.passed) ? "passed" : "failed";
  } finally {
    await cleanupWorkspace(ws);
  }
}

async function runTrial(
  task: BuildTask,
  rt: ReturnType<typeof resolveCellRuntime>,
  agent: string,
  options: BuildRunOptions,
): Promise<BuildAttempt> {
  const ws = await createWorkspace(task.workspacePath);
  let failed = true;
  try {
    try {
      await runSetup(ws, task.setup, { timeoutMs: SETUP_TIMEOUT_MS });
    } catch (e) {
      if (e instanceof SetupError) {
        return { status: "error", reason: `setup failed: ${e.command}` };
      }
      throw e;
    }
    await baselineWorkspace(ws);

    const target = options.targetFactory
      ? options.targetFactory(agent, rt.target)
      : createTarget(agent, rt.target);

    const controller = new AbortController();
    const budgetMs = options.agentTimeoutMs ?? AGENT_TIMEOUT_MS;
    let timedOut: boolean;
    try {
      timedOut = await raceTimeout(
        target.run(task.goal, {
          tool: options.tool,
          cwd: ws.dir,
          promptContext: rt.promptContext,
          restrictBuiltinTools: rt.runOptions.restrictBuiltinTools,
          webTools: rt.runOptions.webTools,
          mcpTools: rt.runOptions.mcpTools,
          signal: controller.signal,
          onProgress: options.onProgress,
        }),
        budgetMs,
        () => controller.abort(),
      );
    } catch (e) {
      const message = errMsg(e);
      if (/reached maximum number of turns/i.test(message)) {
        return {
          status: "failed",
          reason: `agent run reached the turn budget: ${message}`,
        };
      }
      return { status: "error", reason: `agent run failed: ${message}` };
    }
    if (timedOut) {
      return {
        status: "failed",
        reason: `agent run exceeded the ${Math.round(budgetMs / 1000)}s budget`,
      };
    }

    const diff = await captureDiff(ws);
    if (diff.changedFiles.length === 0) {
      return {
        status: "failed",
        reason: "no changes: the agent did not modify the workspace",
        changedFiles: [],
        diff: "",
      };
    }

    const isHarness = (p: string | undefined): boolean =>
      p !== undefined && HARNESS_GLOBS.some((g) => new Glob(g).match(p));
    const weakened = diff.changedFiles.filter((f) => {
      if (f.status === "R") return isHarness(f.oldPath);
      if (f.status === "M" || f.status === "D") return isHarness(f.path);
      return false;
    });
    if (weakened.length > 0) {
      return {
        status: "failed",
        reason: `weakened the test harness: ${weakened.map((f) => f.oldPath ?? f.path).join(", ")}`,
        changedFiles: diff.changedFiles,
        diff: diff.diff,
      };
    }

    const commands = await runVerifier(ws, task);
    const allPass = commands.every((c) => c.passed);
    failed = !allPass;
    return {
      status: allPass ? "passed" : "failed",
      reason: allPass
        ? undefined
        : `verification failed: ${commands
            .filter((c) => !c.passed)
            .map((c) => c.name)
            .join(", ")}`,
      changedFiles: diff.changedFiles,
      diff: diff.diff,
      commands,
    };
  } finally {
    await cleanupWorkspace(ws, {
      keepOnFailure: options.keepOnFailure,
      failed,
    });
  }
}

/** Run failToPass + passToPass, tagging each receipt with its group. */
async function runVerifier(
  ws: Workspace,
  task: BuildTask,
): Promise<CommandReceipt[]> {
  const out: CommandReceipt[] = [];
  const groups: Array<[VerifierGroup, CommandSpec[]]> = [
    ["failToPass", task.failToPass],
    ["passToPass", task.passToPass],
  ];
  for (const [group, cmds] of groups) {
    const results = await runCommands(ws, cmds, {
      timeoutMs: VERIFY_TIMEOUT_MS,
    });
    for (const r of results) {
      out.push({
        group,
        name: r.name,
        run: r.run,
        exitCode: r.exitCode,
        passed: r.passed,
        stdout: r.stdout,
        stderr: r.stderr,
        timedOut: r.timedOut,
      });
    }
  }
  return out;
}

async function raceTimeout(
  promise: Promise<unknown>,
  ms: number,
  onTimeout: () => void,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((res) => {
    timer = setTimeout(() => res("timeout"), ms);
  });
  const settled = promise.then(
    () => ({ ok: true }) as const,
    (e) => ({ ok: false, error: e }) as const,
  );
  const result = await Promise.race([settled, timeout]);
  if (timer) clearTimeout(timer);
  if (result === "timeout") {
    onTimeout();
    return true;
  }
  if (!result.ok) throw result.error;
  return false;
}

function errorCell(
  coord: CellCoord,
  mode: BuildCell["mode"],
  source: string | null,
  message: string,
  verifierProof: VerifierProof = "not_declared",
): BuildCell {
  return {
    coord,
    mode,
    source,
    verdict: "NO",
    passedAttempts: 0,
    totalAttempts: 0,
    passRate: 0,
    attempts: [],
    reason: message,
    verifierProof,
    error: message,
  };
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export { AGENT_TIMEOUT_MS, VERIFY_TIMEOUT_MS, HARNESS_GLOBS };
