import path from "node:path";
import type { Config } from "@pickled-dev/config";
import {
  formatJSON,
  loadConfig,
  printReport,
  type RunReport,
  run,
  runPasses,
  type TaskKind,
} from "@pickled-dev/core";
import chalk from "chalk";

export interface CheckOptions {
  json?: boolean;
  output?: string;
  verbose?: boolean;
  threshold?: string;
  /** Run only the named task id. */
  task?: string;
  /** Run only the named agent. */
  agent?: string;
  /** Run only the named context. */
  context?: string;
  /** Dry-run: expand and report planned cells without running agents. */
  plan?: boolean;
  /** Hard cap on selected executions; exits non-zero before any run if exceeded. */
  maxCells?: string;
  /** Deterministic per-task sample size. */
  sample?: string;
  /** Seed for --sample. */
  seed?: string;
  /** Build only: keep failed workspaces for inspection. */
  keepOnFailure?: boolean;
  /** Build only: prove the harness (preflight + reference), no agent runs. */
  verifyOnly?: boolean;
}

export async function check(
  targetPath: string,
  options: CheckOptions,
): Promise<void> {
  return runTasks(targetPath, options, "question");
}

/**
 * Shared body for `pickled check` (questions) and `pickled build` (builds).
 * Loads the config and dispatches to the v2 runner for the requested kind. A
 * config with only the other kind is "nothing to run", not an error.
 */
export async function runTasks(
  targetPath: string,
  options: CheckOptions,
  kind: TaskKind,
): Promise<void> {
  const { json, output, verbose } = options;
  const log = (msg: string) => {
    if (!json) console.log(msg);
  };
  const resolvedPath = path.resolve(targetPath);

  let config: Config;
  try {
    config = await loadConfig(resolvedPath);
  } catch (error) {
    console.error(chalk.red(error instanceof Error ? error.message : error));
    console.error();
    console.error(chalk.dim("Run `pickled init` to create a config file"));
    process.exit(1);
  }

  // Global options are validated regardless of whether this kind has tasks, so
  // a malformed flag fails fast even on a config that has nothing of this kind.
  // --agent/--context reference global config; --threshold/--sample/--max-cells
  // are value checks. --task is kind-scoped and validated after the empty check
  // below, so `pickled build --task x` on a questions-only config says "No
  // builds" rather than "unknown task".
  validateNamedFilter("agent", options.agent, Object.keys(config.agents));
  validateNamedFilter("context", options.context, Object.keys(config.contexts));

  // CLI --threshold overrides the per-kind config threshold for this run.
  let threshold: number | undefined;
  try {
    threshold = resolveThreshold(
      options.threshold,
      kind === "question"
        ? config.thresholds.questions
        : config.thresholds.builds,
    );
  } catch (error) {
    console.error(chalk.red(error instanceof Error ? error.message : error));
    process.exit(1);
  }

  const sampleN = parseOptionalInt(options.sample, "--sample");
  const maxCellsN = parseOptionalInt(options.maxCells, "--max-cells");

  const tasks = kind === "question" ? config.questions : config.builds;
  if (tasks.length === 0) {
    // Nothing of this kind to run is not a failure (exit 0). Human output gets a
    // hint; machine consumers (--json / --output) get a valid empty RunReport so
    // a parser never sees empty stdout.
    if (json || output) {
      const empty = emptyReport(config, kind);
      if (output) await Bun.write(output, formatJSON(empty));
      else await writeStdout(`${formatJSON(empty)}\n`);
    } else {
      const noun = kind === "build" ? "builds" : "questions";
      const other = kind === "build" ? "pickled check" : "pickled build";
      log(
        chalk.dim(
          `No ${noun} in pickled.yml. Nothing to run. (Did you mean \`${other}\`?)`,
        ),
      );
    }
    return;
  }

  validateNamedFilter(
    "task",
    options.task,
    tasks.map((t) => t.id),
  );

  const tool = {
    name: config.product.name,
    description: config.product.description,
    path: resolvedPath,
  };

  let report: RunReport;
  try {
    report = await run(kind, tool, config, {
      onProgress:
        verbose && !json ? (msg) => log(chalk.dim(`   ${msg}`)) : undefined,
      cellFilter: { agent: options.agent, context: options.context },
      taskFilter: options.task ? [options.task] : undefined,
      plan: options.plan,
      maxCells: maxCellsN,
      sample: sampleN,
      seed: options.seed,
      keepOnFailure: options.keepOnFailure,
    });
  } catch (error) {
    console.error(chalk.red(error instanceof Error ? error.message : error));
    process.exit(1);
  }

  // The CLI threshold overrides whatever the runner stamped from config.
  report.threshold = threshold;

  if (output) {
    await Bun.write(output, formatJSON(report, { verbose }));
  } else if (json) {
    await writeStdout(`${formatJSON(report, { verbose })}\n`);
  } else {
    printReport(report);
  }

  // Dry-run never fails the gate: a plan has no scores to compare.
  if (options.plan) return;
  const passes = runPasses(report.summary, report.threshold);
  if (passes === false) {
    if (json || output) {
      console.error(
        chalk.red(
          `Overall: ${report.summary.score} / 100 · threshold ${report.threshold} · run fails`,
        ),
      );
    }
    process.exit(1);
  }
}

/**
 * Resolve the effective threshold. CLI value wins; else the per-kind config
 * value (already validated 1-100 or undefined). Undefined means no gate.
 */
export function resolveThreshold(
  cliValue: string | undefined,
  configValue: number | undefined,
): number | undefined {
  if (cliValue === undefined) return configValue;
  if (!/^\d+$/.test(cliValue)) {
    throw new Error(
      `Invalid --threshold "${cliValue}". Expected an integer from 1 to 100.`,
    );
  }
  const n = Number(cliValue);
  if (n < 1 || n > 100) {
    throw new Error(
      `Invalid --threshold "${cliValue}". Expected an integer from 1 to 100.`,
    );
  }
  return n;
}

function parseOptionalInt(
  value: string | undefined,
  label: string,
): number | undefined {
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value) || Number(value) < 1) {
    console.error(
      chalk.red(`Invalid ${label} "${value}". Expected a positive integer.`),
    );
    process.exit(1);
  }
  return Number(value);
}

function validateNamedFilter(
  label: "task" | "agent" | "context",
  value: string | undefined,
  names: string[],
): void {
  if (!value || names.includes(value)) return;
  const available = names.length > 0 ? names.join(", ") : "(none)";
  const plural =
    label === "context" ? "contexts" : label === "task" ? "tasks" : "agents";
  console.error(
    chalk.red(
      `Unknown ${label}: "${value}". Available ${plural}: ${available}`,
    ),
  );
  process.exit(1);
}

/** A valid, fully-shaped RunReport for "no tasks of this kind" (machine output). */
function emptyReport(config: Config, kind: TaskKind): RunReport {
  return {
    product: config.product,
    sources: [],
    facts: config.facts,
    misstatements: config.misstatements,
    kind: kind === "question" ? "questions" : "builds",
    ...(kind === "question" ? { questions: [] } : { builds: [] }),
    summary: { total: 0, yes: 0, partial: 0, no: 0, errors: 0, score: 0 },
  };
}

function writeStdout(text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    process.stdout.write(text, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}
