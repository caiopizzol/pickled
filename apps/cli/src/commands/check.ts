import path from "node:path";
import type { CheckConfig } from "@pickled-dev/config";
import { overrideTarget } from "@pickled-dev/config";
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
  target?: string;
  /** Matrix cell filter: run only cells with this interface. */
  interface?: string;
  /** Matrix cell filter: run only cells with this source id. */
  source?: string;
  /** Matrix cell filter: run only cells with this toolset name. */
  toolset?: string;
  /** Run only the named scenario. Designed for CI matrix one-job-per-cell. */
  scenario?: string;
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

  // Apply --target override before runCheck. The helper validates the name
  // and drops scenarios whose explicit target does not match (their author
  // declared a different target; silently rerouting would violate intent).
  if (options.target) {
    const before = config.scenarios.length;
    try {
      config = overrideTarget(config, options.target);
    } catch (error) {
      console.error(
        chalk.red(error instanceof Error ? error.message : String(error)),
      );
      process.exit(1);
    }
    const dropped = before - config.scenarios.length;
    if (dropped > 0 && !json) {
      log(
        chalk.dim(
          `Skipping ${dropped} scenario(s) with explicit target != "${options.target}"`,
        ),
      );
    }
  }

  const tool = {
    name: config.tool.name,
    description: config.tool.description,
    path: resolvedPath,
  };

  if (verbose) {
    log(chalk.bold("pickled check"));
    log("");
    log(chalk.dim(`   Tool: ${tool.name}`));
    log(chalk.dim(`   Scenarios: ${config.scenarios.length}`));
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
  // --target bridges to cellFilter.interface for matrix scenarios when
  // --interface is not also set. Keeps "pickled check --target codex"
  // doing the intuitive thing across both non-matrix and matrix scenarios:
  // narrow the top-level matrix.target (via overrideTarget above) AND
  // narrow matrix.interfaces to the same name. Explicit --interface wins
  // if both are passed.
  const effectiveInterfaceFilter = options.interface ?? options.target;
  const cellFilter =
    effectiveInterfaceFilter || options.source || options.toolset
      ? {
          interface: effectiveInterfaceFilter,
          source: options.source,
          toolset: options.toolset,
        }
      : undefined;
  const scenarioFilter = options.scenario ? [options.scenario] : undefined;

  const report = await runCheck(tool, config, {
    onProgress: verbose
      ? (msg) => {
          if (!json) {
            log(chalk.dim(`   ${msg}`));
          }
        }
      : undefined,
    cellFilter,
    scenarioFilter,
  });

  // 3. Check threshold
  const thresholdFailed = threshold > 0 && report.summary.score < threshold;

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
        chalk.dim("Review failed scenarios before trusting this surface."),
      );
    }
    process.exit(1);
  }
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

function writeStdout(text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    process.stdout.write(text, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}
