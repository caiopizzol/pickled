import chalk from "chalk";
import {
  getScenarioStatus,
  type ScenarioStatus,
  type StatusTone,
} from "./report-status.js";
import type { CheckReport, ScenarioResult } from "./types.js";

const LINE = "─".repeat(55);

type ChalkFn = typeof chalk.green;

function toneToColor(tone: StatusTone): ChalkFn {
  if (tone === "success") return chalk.green;
  if (tone === "warning") return chalk.yellow;
  return chalk.red;
}

function getOverallColor(score: number): ChalkFn {
  if (score >= 70) return chalk.green;
  if (score >= 50) return chalk.yellow;
  return chalk.red;
}

function renderStatusLine(status: ScenarioStatus): string {
  // Error has no meaningful confidence; everything else shows the percent.
  if (status.label === "Error") return status.label;
  return `${status.label} (${status.confidence}%)`;
}

function getResultStatus(result: ScenarioResult): {
  icon: string;
  status: string;
  color: ChalkFn;
} {
  const status = getScenarioStatus(result);
  const color = toneToColor(status.tone);
  return {
    icon: color(status.icon),
    status: renderStatusLine(status),
    color,
  };
}

function formatResultLabel(result: ScenarioResult): string {
  const target = result.target?.target ?? "default";
  const context = result.context?.name ?? "default";

  if (target === "default" && context === "default") {
    return "";
  }

  if (context === "default") {
    return chalk.dim(`[${target}]`);
  }

  return chalk.dim(`[${target}/${context}]`);
}

function hasMatrixResults(results: ScenarioResult[]): boolean {
  const scenarioNames = results.map((r) => r.scenario.name);
  return new Set(scenarioNames).size !== scenarioNames.length;
}

export interface FormatReportOptions {
  threshold?: number;
}

function formatIds(ids: string[]): string {
  return ids.map((id) => `[${id}]`).join(", ");
}

function formatDetails(result: ScenarioResult, indent: string): string[] {
  const lines: string[] = [];

  if (result.error) {
    lines.push(chalk.dim(`${indent}error: ${result.error}`));
    return lines;
  }

  if (result.traps.fired.length > 0) {
    for (const hit of result.traps.fired) {
      lines.push(chalk.red(`${indent}trap: ${hit.id}`));
      lines.push(chalk.dim(`${indent}reason: ${hit.reason}`));
      lines.push(chalk.dim(`${indent}match: "${hit.matched}"`));
    }
  } else if (result.reason && result.answerable !== "YES") {
    lines.push(chalk.dim(`${indent}reason: ${result.reason}`));
  }

  if (result.citations.cited.length > 0) {
    lines.push(
      chalk.dim(`${indent}cited: ${formatIds(result.citations.cited)}`),
    );
  }
  if (result.citations.missing.length > 0) {
    lines.push(
      chalk.dim(`${indent}missing: ${formatIds(result.citations.missing)}`),
    );
  }
  if (result.citations.unknown.length > 0) {
    lines.push(
      chalk.dim(`${indent}unknown: ${formatIds(result.citations.unknown)}`),
    );
  }

  return lines;
}

function formatResultLine(result: ScenarioResult): string {
  const { icon, status, color } = getResultStatus(result);
  const label = formatResultLabel(result);
  const statusText = `${icon} ${status}`;
  return label ? `${label} ${color(statusText)}` : color(statusText);
}

function getSummaryGuidance(scenarios: ScenarioResult[]): string {
  const trapCount = scenarios.reduce((sum, result) => {
    return sum + result.traps.fired.length;
  }, 0);
  const missingCount = scenarios.reduce((sum, result) => {
    return sum + result.citations.missing.length;
  }, 0);
  const unknownCount = scenarios.reduce((sum, result) => {
    return sum + result.citations.unknown.length;
  }, 0);

  if (trapCount > 0 && missingCount + unknownCount > 0) {
    return "Review fired traps and citation gaps.";
  }
  if (trapCount > 0) {
    return "Review fired traps before trusting this surface.";
  }
  if (missingCount + unknownCount > 0) {
    return "Review missing and unknown citations.";
  }
  return "Citations hold. No declared traps fired.";
}

function formatOverall(
  report: CheckReport,
  threshold: number | undefined,
): string {
  const score = report.summary.score;
  const color = getOverallColor(score);
  const base = `Overall: ${color(`${score}`)} / 100`;

  if (threshold === undefined || threshold <= 0) {
    return base;
  }

  const passed = score >= threshold;
  const result = passed ? chalk.green("run passes") : chalk.red("run fails");
  return `${base} · threshold ${threshold} · ${result}`;
}

export function formatCheckReport(
  report: CheckReport,
  options: FormatReportOptions = {},
): string {
  const { tool, scenarios, summary } = report;
  const results = scenarios;
  const lines: string[] = [];

  lines.push(chalk.bold("pickled check"));
  lines.push(LINE);
  lines.push(`Tool: ${chalk.cyan(tool.name)}`);

  if (report.docs.length > 0) {
    lines.push(
      `Sources: ${chalk.dim(formatIds(report.docs.map((d) => d.id)))}`,
    );
  } else {
    lines.push(`Sources: ${chalk.dim("none registered")}`);
  }

  lines.push(`Scenarios: ${chalk.dim(String(summary.total))}`);
  lines.push("");

  if (hasMatrixResults(results)) {
    const byScenario = new Map<string, ScenarioResult[]>();
    for (const result of results) {
      const name = result.scenario.name;
      if (!byScenario.has(name)) {
        byScenario.set(name, []);
      }
      byScenario.get(name)?.push(result);
    }

    for (const [scenarioName, scenarioResults] of byScenario) {
      lines.push(`Scenario: ${scenarioName}`);

      for (const result of scenarioResults) {
        lines.push(`  ${formatResultLine(result)}`);
        lines.push(...formatDetails(result, "    "));
      }

      lines.push("");
    }
  } else {
    for (const result of results) {
      lines.push(`Scenario: ${result.scenario.name}`);
      lines.push(`  ${formatResultLine(result)}`);
      lines.push(...formatDetails(result, "  "));
      lines.push("");
    }
  }

  lines.push(LINE);
  lines.push(formatOverall(report, options.threshold));
  lines.push(chalk.dim(getSummaryGuidance(scenarios)));

  return lines.join("\n");
}

export function printCheckReport(
  report: CheckReport,
  options: FormatReportOptions = {},
): void {
  console.log(formatCheckReport(report, options));
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
