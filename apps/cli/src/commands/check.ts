import {
  formatCheckJSON,
  loadConfig,
  printCheckReport,
  runCheck,
} from "@pickled-dev/core";
import chalk from "chalk";
import path from "node:path";

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
  const log = (msg: string) => !json && console.log(chalk.dim(msg));

  const resolvedPath = path.resolve(targetPath);

  // 1. Load config (required)
  log("🥒 Loading pickled.yml...");

  let config;
  try {
    config = await loadConfig(resolvedPath);
  } catch (error) {
    console.error(chalk.red(`🥒 ${error instanceof Error ? error.message : error}`));
    console.error();
    console.error(chalk.dim("Run `pickled init` to create a config file"));
    process.exit(1);
  }

  const tool = {
    name: config.tool.name,
    description: config.tool.description,
    keywords: config.tool.keywords,
    path: resolvedPath,
  };

  if (verbose) {
    log(`   Tool: ${tool.name}`);
    log(`   Scenarios: ${config.scenarios.length}`);
    for (const s of config.scenarios) {
      log(`   - ${s.name}`);
    }
  }

  // 2. Run check
  log("📊 Checking your freshness...");
  console.log();

  const report = await runCheck(tool, config.scenarios, {
    ...config.runner,
    onProgress: (msg) => {
      if (verbose || !json) {
        console.log(chalk.dim(`   ${msg}`));
      }
    },
  });

  // 3. Output
  if (output) {
    await Bun.write(output, formatCheckJSON(report));
    log(`\n🥒 Report saved to ${output}`);
  } else if (json) {
    console.log(formatCheckJSON(report));
  } else {
    printCheckReport(report);
  }

  // 4. Check threshold
  const threshold = options.threshold
    ? parseInt(options.threshold, 10)
    : (config.threshold ?? 0);

  if (report.summary.freshness < threshold) {
    console.error(chalk.red(`\n🥒 Freshness ${report.summary.freshness}% is below threshold ${threshold}%`));
    process.exit(1);
  }
}
