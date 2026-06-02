import type { CheckConfig, ResolvedDocSource } from "@pickled-dev/config";
import { Glob } from "bun";
import { resolveCellRuntime } from "../cell-runtime.js";
import { assertEditCapable, createTarget } from "../targets/index.js";
import type { ResolvedContext, TargetRunner } from "../targets/types.js";
import type { BuildAttempt, CellResult, ToolInfo } from "../types.js";
import { type CommandSpec, runCommands } from "./verifiers.js";
import {
  baselineWorkspace,
  captureDiff,
  cleanupWorkspace,
  createWorkspace,
  runSetup,
  SetupError,
} from "./workspace.js";

/** Internal timeouts so a hung agent or verify command cannot stall CI. */
const AGENT_TIMEOUT_MS = 600_000;
const VERIFY_TIMEOUT_MS = 300_000;
const SETUP_TIMEOUT_MS = 600_000;

/** Baseline files the agent must not weaken to pass. Test files only in v1. */
const HARNESS_GLOBS = ["**/*.test.*", "**/*.spec.*", "tests/**", "test/**"];

export interface BuildTask {
  name: string;
  prompt: string;
  workspacePath: string;
  setup: string[];
  verify: CommandSpec[];
  trials: number;
}

export interface BuildCellInput {
  task: BuildTask;
  interfaceName: string;
  accessPair: { access?: string; source: string | null; toolset: string };
  config: CheckConfig;
  docs: ResolvedDocSource[];
  tool: ToolInfo;
  contextConfig: ResolvedContext;
  /** Test seam: build a target from the per-cell config (defaults to createTarget). */
  targetFactory?: (name: string, config: unknown) => TargetRunner;
  keepOnFailure?: boolean;
  /** Wall-clock budget for one agent run. Defaults to AGENT_TIMEOUT_MS; tests
   *  pass a small value to exercise the timeout/cancellation path. */
  agentTimeoutMs?: number;
  onProgress?: (msg: string) => void;
}

/**
 * Run one build cell (agent × access): a vacuous-fixture preflight, then
 * `task.trials` independent trials, each in a fresh workspace. Returns a
 * CellResult carrying the `build` block (strict k/n), or an Error cell (no
 * `build` block) for a setup failure or an already-green fixture.
 *
 * Trial independence is load-bearing: captureDiff stages against the per-trial
 * baseline, so trial 2 must NOT inherit trial 1's edits. Each trial therefore
 * gets its own workspace (setup repeats; correctness over cost in v1).
 */
export async function runBuildCell(input: BuildCellInput): Promise<CellResult> {
  const { task, interfaceName, accessPair, config, docs } = input;
  const cellMeta = {
    interface: interfaceName,
    access: accessPair.access,
    source: accessPair.source,
    toolset: accessPair.toolset,
  };

  // Access composition (target config, source injection, tool scoping) is
  // shared with the answer runner. Outside any try so config errors bubble.
  const rt = resolveCellRuntime({
    interfaceName,
    sourceName: accessPair.source,
    toolsetName: accessPair.toolset,
    config,
    docs,
    requiredSources: [],
    contextConfig: input.contextConfig,
  });

  // Hard gate: a build task only runs on an edit-capable agent. Fail before any
  // workspace, preflight, or paid model call. Throws (config error) the same
  // way resolveCellRuntime's provider gates do.
  assertEditCapable(interfaceName, rt.baseTargetConfig);

  // Preflight: the untouched fixture must FAIL verification. A green baseline
  // means the task measures nothing - that is a bad fixture, an Error cell
  // excluded from scoring, never scored as the agent failing.
  const preflight = await runBaselineVerify(task);
  if (preflight.kind === "setup-error") {
    return errorCell(cellMeta, `setup failed: ${preflight.message}`);
  }
  if (preflight.kind === "already-green") {
    return errorCell(
      cellMeta,
      "invalid fixture: verification already passes on the untouched workspace, so the task measures nothing",
    );
  }

  const attempts: BuildAttempt[] = [];
  for (let i = 0; i < task.trials; i++) {
    input.onProgress?.(`    trial ${i + 1}/${task.trials}`);
    attempts.push(await runTrial(input, rt));
  }
  // Errored trials (trial-local setup failure, agent crash) are environment,
  // not agent work: keep them in attempts[] as receipts but exclude them from
  // the k/n denominator so a flaky install or infra blip cannot tank the rate.
  const scored = attempts.filter((a) => a.status !== "error");
  const passedAttempts = scored.filter((a) => a.status === "passed").length;
  const totalAttempts = scored.length;

  // Every trial errored: no scored measurement, so this is an Error cell, not a
  // 0/0 build.
  if (totalAttempts === 0) {
    const reasons = attempts
      .map((a) => a.reason)
      .filter(Boolean)
      .join("; ");
    return errorCell(
      cellMeta,
      `could not measure: all ${attempts.length} trial(s) errored${reasons ? ` (${reasons})` : ""}`,
    );
  }

  // Strict verdict: YES only if every scored trial built. confidence = rate.
  const answerable =
    passedAttempts === totalAttempts
      ? "YES"
      : passedAttempts === 0
        ? "NO"
        : "PARTIAL";
  const confidence = Math.round((passedAttempts / totalAttempts) * 100);

  return {
    cell: cellMeta,
    taskKind: "build",
    answerable,
    confidence,
    response: "",
    reason: `Built ${passedAttempts}/${totalAttempts}`,
    citations: null,
    build: { attempts, passedAttempts, totalAttempts },
  };
}

type PreflightResult =
  | { kind: "setup-error"; message: string }
  | { kind: "already-green" }
  | { kind: "ok" };

/** Create a throwaway workspace, run setup, run verify on it untouched. */
async function runBaselineVerify(task: BuildTask): Promise<PreflightResult> {
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
    const results = await runCommands(ws, task.verify, {
      timeoutMs: VERIFY_TIMEOUT_MS,
    });
    const allPass = results.every((r) => r.passed);
    return allPass ? { kind: "already-green" } : { kind: "ok" };
  } finally {
    await cleanupWorkspace(ws);
  }
}

async function runTrial(
  input: BuildCellInput,
  rt: ReturnType<typeof resolveCellRuntime>,
): Promise<BuildAttempt> {
  const { task, interfaceName, tool } = input;
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

    const target = input.targetFactory
      ? input.targetFactory(interfaceName, rt.targetConfig)
      : createTarget(interfaceName, rt.targetConfig);

    // Wall-clock bound on the agent run so a hung agent cannot stall CI. The
    // SDK's maxTurns bounds turns, not time; this is the time backstop. On
    // timeout the runner aborts the controller, which the adapters wire to a
    // real teardown (claude-code abortController, codex proc.kill), so the
    // agent process is cancelled, not just abandoned. A timeout is a
    // non-success trial (the agent did not finish in budget), counted against
    // the rate.
    const controller = new AbortController();
    const budgetMs = input.agentTimeoutMs ?? AGENT_TIMEOUT_MS;
    let timedOut: boolean;
    try {
      timedOut = await raceTimeout(
        target.run(task.prompt, {
          tool,
          cwd: ws.dir,
          docs: [],
          requiredSources: [],
          editMode: true,
          buildContext: {
            docs: rt.cellDocs,
            sourceHint: rt.discoveryHint?.sourceHint ?? null,
          },
          restrictBuiltinTools: rt.runOptions.restrictBuiltinTools,
          webTools: rt.runOptions.webTools,
          mcpTools: rt.runOptions.mcpTools,
          signal: controller.signal,
          onProgress: input.onProgress,
        }),
        budgetMs,
        () => controller.abort(),
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (isAgentTurnBudgetExhausted(message)) {
        return {
          status: "failed",
          reason: `agent run reached the turn budget: ${message}`,
        };
      }
      // The agent run threw (e.g. codex exited non-zero). We cannot tell an
      // agent failure from an infra failure here, so quarantine it as an error
      // trial (excluded from the rate) rather than crash the whole cell.
      return {
        status: "error",
        reason: `agent run failed: ${message}`,
      };
    }
    if (timedOut) {
      return {
        status: "failed",
        reason: `agent run exceeded the ${Math.round(budgetMs / 1000)}s budget`,
      };
    }

    const diff = await captureDiff(ws);

    // Empty-diff veto: no work happened.
    if (diff.changedFiles.length === 0) {
      return {
        status: "failed",
        reason: "no changes: the agent did not modify the workspace",
        changedFiles: [],
        diff: "",
      };
    }

    // Harness veto: the agent must not weaken baseline test files. A modify (M)
    // or delete (D) of a baseline test fails; a rename (R) AWAY from a test path
    // (oldPath was a test) also fails - that is a disguised delete. Adding (A) a
    // new test is fine.
    const isHarness = (p: string | undefined): boolean =>
      p !== undefined && HARNESS_GLOBS.some((g) => new Glob(g).match(p));
    const weakened = diff.changedFiles.filter((f) => {
      if (f.status === "R") return isHarness(f.oldPath);
      if (f.status === "M" || f.status === "D") return isHarness(f.path);
      return false; // A (add) / C (copy) leave the baseline test intact
    });
    if (weakened.length > 0) {
      return {
        status: "failed",
        reason: `weakened the test harness: ${weakened.map((f) => f.oldPath ?? f.path).join(", ")}`,
        changedFiles: diff.changedFiles,
        diff: diff.diff,
      };
    }

    const commands = await runCommands(ws, task.verify, {
      timeoutMs: VERIFY_TIMEOUT_MS,
    });
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
    const res = await cleanupWorkspace(ws, {
      keepOnFailure: input.keepOnFailure,
      failed,
    });
    void res;
  }
}

function isAgentTurnBudgetExhausted(message: string): boolean {
  return /reached maximum number of turns/i.test(message);
}

/**
 * Resolve to false when `promise` settles first, true if `ms` elapses first.
 * On timeout, `onTimeout` runs (the runner aborts the controller, which the
 * adapters wire to a real process teardown). The orphaned promise is left to
 * settle on its own; we do not await it.
 */
async function raceTimeout(
  promise: Promise<unknown>,
  ms: number,
  onTimeout: () => void,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), ms);
  });
  // `settled` never rejects: it captures success vs failure as a value, so a
  // late rejection from a post-timeout abandoned run cannot become an unhandled
  // rejection. A rejection that arrives BEFORE the timeout is rethrown below so
  // the caller records an error attempt.
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

function errorCell(cellMeta: CellResult["cell"], message: string): CellResult {
  return {
    cell: cellMeta,
    taskKind: "build",
    answerable: "NO",
    confidence: 0,
    response: "",
    reason: message,
    citations: null,
    error: message,
  };
}

export { AGENT_TIMEOUT_MS, VERIFY_TIMEOUT_MS, HARNESS_GLOBS };
