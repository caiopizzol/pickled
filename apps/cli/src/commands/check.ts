import path from "node:path";
import type { CheckConfig } from "@pickled-dev/config";
import {
  formatCheckJSON,
  loadConfig,
  printCheckReport,
  runCheck,
} from "@pickled-dev/core";
import chalk from "chalk";

export interface CheckOptions {
  json?: boolean;
  output?: string;
  verbose?: boolean;
  threshold?: string;
  /** Run only the named question id. */
  question?: string;
  /** Run only the named agent. */
  agent?: string;
  /** Run only the named access path. */
  access?: string;
  /** Dry-run: expand and report planned cells without running adapters. */
  plan?: boolean;
  /** Hard cap on selected cells; exits non-zero before any run if exceeded. */
  maxCells?: string;
  /** Deterministic per-question sample size. */
  sample?: string;
  /** Seed for --sample. */
  seed?: string;
}

export async function check(
  targetPath: string,
  options: CheckOptions,
): Promise<void> {
  const { json, output, verbose } = options;
  const log = (msg: string) => !json && console.log(msg);

  const resolvedPath = path.resolve(targetPath);

  // 1. Load config (required)
  let config: CheckConfig;
  try {
    config = await loadConfig(resolvedPath);
  } catch (error) {
    console.error(chalk.red(error instanceof Error ? error.message : error));
    console.error();
    console.error(chalk.dim("Run `pickled init` to create a config file"));
    process.exit(1);
  }

  validateNamedFilter(config, "question", options.question, listQuestions);
  validateNamedFilter(config, "agent", options.agent, listAgents);
  validateNamedFilter(config, "access", options.access, listAccessPaths);

  const tool = {
    name: config.tool.name,
    description: config.tool.description,
    path: resolvedPath,
  };

  if (verbose) {
    log(chalk.bold("pickled check"));
    log("");
    log(chalk.dim(`   Tool: ${tool.name}`));
    log(chalk.dim(`   Questions: ${config.scenarios.length}`));
    for (const s of config.scenarios) {
      log(chalk.dim(`   - ${s.name}`));
    }
  }

  let threshold: number;
  try {
    threshold = resolveThreshold(options.threshold, config.threshold);
  } catch (error) {
    console.error(chalk.red(error instanceof Error ? error.message : error));
    process.exit(1);
  }

  // 2. Run check
  const cellFilter =
    options.agent || options.access
      ? {
          interface: options.agent,
          access: options.access,
        }
      : undefined;
  const scenarioFilter = options.question ? [options.question] : undefined;

  let sampleN: number | undefined;
  if (options.sample !== undefined) {
    sampleN = parsePositiveInt(options.sample, "--sample");
    if (sampleN === null) process.exit(1);
  }
  let maxCellsN: number | undefined;
  if (options.maxCells !== undefined) {
    maxCellsN = parsePositiveInt(options.maxCells, "--max-cells");
    if (maxCellsN === null) process.exit(1);
  }

  let report: Awaited<ReturnType<typeof runCheck>>;
  try {
    report = await runCheck(tool, config, {
      onProgress: verbose
        ? (msg) => {
            if (!json) {
              log(chalk.dim(`   ${msg}`));
            }
          }
        : undefined,
      cellFilter,
      scenarioFilter,
      plan: options.plan,
      maxCells: maxCellsN,
      sample: sampleN,
      seed: options.seed,
    });
  } catch (error) {
    console.error(chalk.red(error instanceof Error ? error.message : error));
    process.exit(1);
  }

  // 3. Check threshold (skipped in plan / dry-run mode: a planning
  // report has no question scores to compare against, and a non-zero
  // exit there would defeat the purpose of a free pre-flight).
  const thresholdFailed = shouldFailThreshold({
    plan: options.plan === true,
    threshold,
    score: report.summary.score,
  });

  // 4. Output
  if (output) {
    await Bun.write(output, formatCheckJSON(report, { verbose }));
  } else if (json) {
    await writeStdout(`${formatCheckJSON(report, { verbose })}\n`);
  } else {
    printCheckReport(report, { threshold });
  }

  if (thresholdFailed) {
    if (json || output) {
      console.error(
        chalk.red(
          `Overall: ${report.summary.score} / 100 · threshold ${threshold} · run fails`,
        ),
      );
      console.error(
        chalk.dim("Review failed questions before trusting this surface."),
      );
    }
    process.exit(1);
  }
}

/**
 * Whether the run should exit non-zero on threshold. Dry-run (`--plan`)
 * always passes the threshold gate because the planning report has no
 * question scores; failing here would defeat the free pre-flight.
 */
export function shouldFailThreshold(args: {
  plan: boolean;
  threshold: number;
  score: number;
}): boolean {
  if (args.plan) return false;
  return args.threshold > 0 && args.score < args.threshold;
}

export function resolveThreshold(
  cliValue: string | undefined,
  configValue: unknown,
): number {
  if (cliValue === undefined) {
    if (configValue === undefined) return 0;
    return parseThresholdValue(configValue, "pickled.yml threshold");
  }

  return parseThresholdValue(cliValue, "--threshold");
}

function parsePositiveInt(value: string, label: string): number | null {
  if (!/^\d+$/.test(value)) {
    console.error(
      chalk.red(
        `Invalid ${label} "${value}". Expected a non-negative integer.`,
      ),
    );
    return null;
  }
  return Number(value);
}

function parseThresholdValue(value: unknown, label: string): number {
  if (typeof value === "number") {
    if (Number.isInteger(value) && value >= 0 && value <= 100) return value;
    throw new Error(
      `Invalid ${label} "${value}". Expected an integer from 0 to 100.`,
    );
  }

  if (typeof value === "string" && /^\d+$/.test(value)) {
    const threshold = Number(value);
    if (threshold <= 100) return threshold;
  }

  if (typeof value === "string") {
    throw new Error(
      `Invalid ${label} "${value}". Expected an integer from 0 to 100.`,
    );
  }

  throw new Error(`Invalid ${label}. Expected an integer from 0 to 100.`);
}

function validateNamedFilter(
  config: CheckConfig,
  label: "question" | "agent" | "access",
  value: string | undefined,
  list: (config: CheckConfig) => string[],
): void {
  if (!value) return;
  const names = list(config);
  if (names.includes(value)) return;
  const available = names.length > 0 ? names.join(", ") : "(none)";
  const plural =
    label === "access"
      ? "access paths"
      : label === "question"
        ? "questions"
        : "agents";
  console.error(
    chalk.red(
      `Unknown ${label}: "${value}". Available ${plural}: ${available}`,
    ),
  );
  process.exit(1);
}

function listQuestions(config: CheckConfig): string[] {
  return config.scenarios.map((s) => s.name);
}

function listAgents(config: CheckConfig): string[] {
  return Object.keys(config.targets ?? {});
}

function listAccessPaths(config: CheckConfig): string[] {
  const seen = new Set<string>();
  for (const scenario of config.scenarios) {
    for (const pair of scenario.matrix?.accessPairs ?? []) {
      if (pair.access) seen.add(pair.access);
    }
  }
  return [...seen];
}

function writeStdout(text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    process.stdout.write(text, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}
