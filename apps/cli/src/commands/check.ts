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
    console.error(
      chalk.red(`🥒 ${error instanceof Error ? error.message : error}`),
    );
    console.error();
    console.error(chalk.dim("Run `pickled init` to create a config file"));
    process.exit(1);
  }

  const tool = {
    name: config.tool.name,
    description: config.tool.description,
    path: resolvedPath,
  };

  if (verbose) {
    log(chalk.dim(`   Tool: ${tool.name}`));
    log(chalk.dim(`   Scenarios: ${config.scenarios.length}`));
    for (const s of config.scenarios) {
      log(chalk.dim(`   - ${s.name}`));
    }
  }

  // 2. Run check
  log(chalk.dim("🥒 Freshness Check"));
  log("");

  const report = await runCheck(tool, config, {
    onProgress: (msg) => {
      if (!json) {
        log(chalk.dim(`   ${msg}`));
      }
    },
  });

  // 3. Output
  if (output) {
    await Bun.write(output, formatCheckJSON(report));
  } else if (json) {
    console.log(formatCheckJSON(report));
  } else {
    printCheckReport(report);
  }

  // 4. Check threshold
  const threshold = options.threshold
    ? parseInt(options.threshold, 10)
    : (config.threshold ?? 0);

  if (report.summary.score < threshold) {
    console.error("");
    console.error(
      chalk.red(`Freshness score: ${report.summary.score}% 🥒🥒🥒░░`),
    );
    console.error(chalk.dim("Starting to spoil... Some docs need attention."));
    process.exit(1);
  }
}
