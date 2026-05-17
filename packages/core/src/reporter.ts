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

function getStatus(score: number): {
  label: string;
  color: typeof chalk.green;
} {
  if (score >= 90) {
    return { label: "Well grounded", color: chalk.green };
  }
  if (score >= 70) {
    return { label: "Grounded", color: chalk.green };
  }
  if (score >= 50) {
    return { label: "Partially grounded", color: chalk.yellow };
  }
  return { label: "Ungrounded", color: chalk.red };
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

  if (result.traps.fired.length > 0) {
    return {
      icon: chalk.red("✗"),
      status: `Trap fired (${result.confidence}%)`,
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
    status: `Ungrounded (${result.confidence}%)`,
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
  console.log(chalk.bold("🥒 Pickled Check"));
  console.log(LINE);
  console.log();
  console.log(`Tool: ${chalk.cyan(tool.name)}`);

  if (report.docs.length > 0) {
    console.log(
      `Sources: ${chalk.dim(report.docs.map((d) => d.id).join(", "))}`,
    );
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

      for (const hit of result.traps.fired) {
        console.log(chalk.red(`      ↳ trap "${hit.id}": ${hit.reason}`));
        console.log(chalk.dim(`        "${hit.snippet}"`));
      }

      if (result.citations.missing.length > 0) {
        console.log(
          chalk.dim(
            `      Missing citations: ${result.citations.missing.join(", ")}`,
          ),
        );
      }
      if (result.citations.unknown.length > 0) {
        console.log(
          chalk.dim(
            `      Unknown citations: ${result.citations.unknown.join(", ")}`,
          ),
        );
      }
    }

    console.log();
  }

  console.log(LINE);
  console.log(
    `Legibility Score: ${summary.score}% ${getScorePickles(summary.score)}`,
  );
  console.log();

  const { color } = getStatus(summary.score);
  const trapCount = scenarios.reduce((sum, result) => {
    return sum + result.traps.fired.length;
  }, 0);
  if (summary.score >= 90) {
    console.log(color("🥒 Solid grounding. Agents can answer from your docs."));
  } else if (summary.score >= 70) {
    console.log(color("🥒 Mostly grounded with a few gaps."));
  } else if (summary.score >= 50) {
    console.log(
      color("🥒 Partial grounding. Several scenarios need attention."),
    );
  } else {
    const message =
      trapCount > 0
        ? `🥒 ${trapCount} trap(s) fired. Review stale or deprecated guidance.`
        : "🥒 Weak grounding. Most scenarios are missing required citations.";
    console.log(color(message));
  }

  console.log();
}

export interface FormatJSONOptions {
  /** Include full source content + transcripts. Default omits both. */
  verbose?: boolean;
}

/**
 * Format report as JSON. By default omits source content and per-message
 * transcripts to keep output small; pass `verbose: true` for the full payload.
 */
export function formatCheckJSON(
  report: CheckReport,
  options: FormatJSONOptions = {},
): string {
  if (options.verbose) {
    return JSON.stringify(report, null, 2);
  }
  const slim: CheckReport = {
    ...report,
    docs: report.docs.map((d) => ({ ...d, content: "" })),
    scenarios: report.scenarios.map((s) => {
      const { allResponses, ...rest } = s;
      void allResponses;
      return rest;
    }),
  };
  return JSON.stringify(slim, null, 2);
}
