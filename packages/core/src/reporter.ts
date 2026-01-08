import chalk from "chalk";
import type { CheckReport } from "./types.js";

const LINE = "━".repeat(55);

function getFreshnessPickles(freshness: number): string {
  const filled = Math.round(freshness / 20);
  const empty = 5 - filled;
  return "🥒".repeat(filled) + "░".repeat(empty);
}

export function printCheckReport(report: CheckReport): void {
  const { tool, scenarios, summary } = report;

  console.log();
  console.log(chalk.bold(`🥒 pickled check results`));
  console.log(LINE);
  console.log();
  console.log(`Tool: ${chalk.cyan(tool.name)}`);
  console.log(`Path: ${chalk.dim(tool.path)}`);
  console.log();

  for (const result of scenarios) {
    const icon = result.passed ? chalk.green("✓") : chalk.red("✗");
    const status = result.passed
      ? chalk.dim("passed")
      : result.error
        ? chalk.red(`error: ${result.error.slice(0, 40)}`)
        : chalk.yellow("tool not mentioned");

    console.log(`  ${icon} "${result.scenario.name}" - ${status}`);
  }

  console.log();
  console.log(LINE);
  console.log(
    `Freshness: ${summary.passed}/${summary.total} (${summary.freshness}%) ${getFreshnessPickles(summary.freshness)}`,
  );
  console.log();

  if (summary.freshness >= 80) {
    console.log(chalk.green("🥒 Looking fresh! You're kind of a big dill."));
  } else if (summary.freshness >= 60) {
    console.log(chalk.yellow("🥒 Not bad, but room to get fresher."));
  } else {
    console.log(chalk.red("🥒 Time to freshen up your AI presence."));
  }

  console.log();
}

export function formatCheckJSON(report: CheckReport): string {
  return JSON.stringify(report, null, 2);
}
