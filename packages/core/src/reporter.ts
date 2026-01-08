import chalk from "chalk";
import type { CheckReport, ScenarioResult } from "./types.js";

const LINE = "━".repeat(55);

/**
 * Get pickle visualization for score
 */
function getScorePickles(score: number): string {
  const filled = Math.round(score / 20);
  const empty = 5 - filled;
  return "🥒".repeat(filled) + "░".repeat(empty);
}

/**
 * Get branded status based on score (from BRAND.md)
 */
function getStatus(score: number): {
  label: string;
  color: typeof chalk.green;
} {
  if (score >= 90) {
    return { label: "Well preserved", color: chalk.green };
  }
  if (score >= 70) {
    return { label: "Fresh", color: chalk.green };
  }
  if (score >= 50) {
    return { label: "Going stale", color: chalk.yellow };
  }
  return { label: "Gone sour", color: chalk.red };
}

/**
 * Get result icon and status text
 */
function getResultStatus(result: ScenarioResult): {
  icon: string;
  status: string;
  color: typeof chalk.green;
} {
  if (result.error) {
    return {
      icon: chalk.red("✗"),
      status: `error: ${result.error.slice(0, 40)}`,
      color: chalk.red,
    };
  }

  const { label, color } = getStatus(result.confidence);

  if (result.answerable === "YES") {
    return {
      icon: chalk.green("✓"),
      status: `${label} (${result.confidence}%)`,
      color,
    };
  }

  if (result.answerable === "PARTIAL") {
    return {
      icon: chalk.yellow("⚠"),
      status: `${label} (${result.confidence}%)`,
      color: chalk.yellow,
    };
  }

  return {
    icon: chalk.red("✗"),
    status: `Gone sour (${result.confidence}%)`,
    color: chalk.red,
  };
}

/**
 * Format result label for matrix output [target/context]
 */
function formatResultLabel(result: ScenarioResult): string {
  const target = result.target?.target ?? "default";
  const context = result.context?.name ?? "default";

  // Skip label if both are default (non-matrix run)
  if (target === "default" && context === "default") {
    return "";
  }

  // Only show context if not default
  if (context === "default") {
    return chalk.dim(`[${target}]`);
  }

  return chalk.dim(`[${target}/${context}]`);
}

/**
 * Check if report has matrix results (multiple results per scenario)
 */
function hasMatrixResults(results: ScenarioResult[]): boolean {
  const scenarioNames = results.map((r) => r.scenario.name);
  return new Set(scenarioNames).size !== scenarioNames.length;
}

/**
 * Print branded check report to console
 */
export function printCheckReport(report: CheckReport): void {
  const { tool, scenarios, summary } = report;
  const results = scenarios;

  console.log();
  console.log(chalk.bold("🥒 Freshness Check"));
  console.log(LINE);
  console.log();
  console.log(`Tool: ${chalk.cyan(tool.name)}`);

  // Show docs source if available
  if (report.docs) {
    console.log(`Docs: ${chalk.dim(report.docs.source)}`);
  }

  console.log();

  // Check if we have matrix results
  if (hasMatrixResults(results)) {
    // Group by scenario for matrix output
    const byScenario = new Map<string, ScenarioResult[]>();
    for (const result of results) {
      const name = result.scenario.name;
      if (!byScenario.has(name)) {
        byScenario.set(name, []);
      }
      byScenario.get(name)?.push(result);
    }

    // Print grouped
    for (const [scenarioName, scenarioResults] of byScenario) {
      console.log(`  "${scenarioName}"`);

      for (const result of scenarioResults) {
        const label = formatResultLabel(result);
        const { icon, status } = getResultStatus(result);
        const labelPadded = label ? `${label.padEnd(20)} ` : "    ";

        console.log(`    ${labelPadded}${icon} ${status}`);

        // Show reason for non-YES results
        if (result.reason && result.answerable !== "YES") {
          console.log(chalk.dim(`                          ${result.reason}`));
        }
      }

      console.log();
    }
  } else {
    // Flat output for non-matrix runs (single target/context)
    for (const result of results) {
      const { icon, status } = getResultStatus(result);
      const targetLabel = formatResultLabel(result);
      const labelPart = targetLabel ? `${targetLabel} ` : "";

      console.log(
        `  ${labelPart}${icon} "${result.scenario.name}" - ${status}`,
      );

      // Show reason for non-YES results
      if (result.reason && result.answerable !== "YES") {
        console.log(chalk.dim(`      ${result.reason}`));
      }

      // Show missing info
      if (result.missing && result.missing.length > 0) {
        console.log(chalk.dim(`      Missing: ${result.missing.join(", ")}`));
      }
    }

    console.log();
  }

  console.log(LINE);
  console.log(
    `Freshness Score: ${summary.score}% ${getScorePickles(summary.score)}`,
  );
  console.log();

  // Final message based on score
  const { color } = getStatus(summary.score);
  if (summary.score >= 90) {
    console.log(color("🥒 Perfectly preserved! Your docs are in great shape."));
  } else if (summary.score >= 70) {
    console.log(color("🥒 Looking fresh! Your docs are doing well."));
  } else if (summary.score >= 50) {
    console.log(color("🥒 Starting to spoil... Some docs need attention."));
  } else {
    console.log(color("🥒 Something went sour. Time to freshen up your docs."));
  }

  console.log();
}

/**
 * Format report as JSON
 */
export function formatCheckJSON(report: CheckReport): string {
  return JSON.stringify(report, null, 2);
}
