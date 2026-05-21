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
  target?: string;
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

  // Apply --target override before runCheck. Validate against configured
  // targets plus the "default" sentinel; an unknown name should fail cleanly
  // here rather than silently resolving to DEFAULT_TARGET deep in resolveTarget.
  if (options.target) {
    const validNames = new Set([
      ...Object.keys(config.targets ?? {}),
      "default",
    ]);
    if (!validNames.has(options.target)) {
      console.error(chalk.red(`Unknown target: "${options.target}"`));
      console.error(
        chalk.dim(`Available targets: ${[...validNames].join(", ")}`),
      );
      process.exit(1);
    }
    config = {
      ...config,
      matrix: { ...config.matrix, target: [options.target] },
    };
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

  // 2. Run check
  const report = await runCheck(tool, config, {
    onProgress: verbose
      ? (msg) => {
          if (!json) {
            log(chalk.dim(`   ${msg}`));
          }
        }
      : undefined,
  });

  // 3. Check threshold
  const threshold = options.threshold
    ? parseInt(options.threshold, 10)
    : (config.threshold ?? 0);
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

function writeStdout(text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    process.stdout.write(text, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}
