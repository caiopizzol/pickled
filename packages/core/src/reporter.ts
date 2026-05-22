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
  // Single-mode result: top-level evaluation fields are populated.
  const status = getScenarioStatus({
    answerable: result.answerable ?? "NO",
    confidence: result.confidence ?? 0,
    traps: result.traps ?? { fired: [], avoided: [] },
    error: result.error,
  });
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

interface DetailFields {
  error?: string;
  traps: { fired: { id: string; reason: string; matched: string }[] };
  reason: string;
  answerable: "YES" | "PARTIAL" | "NO";
  citations: { cited: string[]; missing: string[]; unknown: string[] };
}

function formatDetailFields(fields: DetailFields, indent: string): string[] {
  const lines: string[] = [];

  if (fields.error) {
    lines.push(chalk.dim(`${indent}error: ${fields.error}`));
    return lines;
  }

  if (fields.traps.fired.length > 0) {
    for (const hit of fields.traps.fired) {
      lines.push(chalk.red(`${indent}trap: ${hit.id}`));
      lines.push(chalk.dim(`${indent}reason: ${hit.reason}`));
      lines.push(chalk.dim(`${indent}match: "${hit.matched}"`));
    }
  } else if (fields.reason && fields.answerable !== "YES") {
    lines.push(chalk.dim(`${indent}reason: ${fields.reason}`));
  }

  if (fields.citations.cited.length > 0) {
    lines.push(
      chalk.dim(`${indent}cited: ${formatIds(fields.citations.cited)}`),
    );
  }
  if (fields.citations.missing.length > 0) {
    lines.push(
      chalk.dim(`${indent}missing: ${formatIds(fields.citations.missing)}`),
    );
  }
  if (fields.citations.unknown.length > 0) {
    lines.push(
      chalk.dim(`${indent}unknown: ${formatIds(fields.citations.unknown)}`),
    );
  }

  return lines;
}

function formatDetails(result: ScenarioResult, indent: string): string[] {
  // Single-mode only. Compare-mode rendering happens in formatCheckReport.
  if (!result.traps || !result.citations) return [];
  return formatDetailFields(
    {
      error: result.error,
      traps: result.traps,
      reason: result.reason ?? "",
      answerable: result.answerable ?? "NO",
      citations: result.citations,
    },
    indent,
  );
}

function formatResultLine(result: ScenarioResult): string {
  const { icon, status, color } = getResultStatus(result);
  const label = formatResultLabel(result);
  const statusText = `${icon} ${status}`;
  return label ? `${label} ${color(statusText)}` : color(statusText);
}

/**
 * Compare-mode block per proposals/compare-surfaces.md Decisions 2 and 5.
 * One preamble line names the intersection citation contract; each surface
 * gets its own status line plus indented details. No synthesized top-level
 * aggregate.
 */
function formatCompareBlock(result: ScenarioResult, indent: string): string[] {
  if (!result.surfaces) return [];
  const lines: string[] = [];
  lines.push(
    `${indent}${chalk.dim("Citations scoped to active surface (compare mode)")}`,
  );
  for (const surface of result.surfaces) {
    const status = getScenarioStatus(surface);
    const color = toneToColor(status.tone);
    const surfaceLabel = chalk.dim(`[${surface.active.join(",")}]`);
    const statusLine = `${color(status.icon)} ${color(renderStatusLine(status))}`;
    lines.push(`${indent}${surfaceLabel} ${statusLine}`);
    lines.push(
      ...formatDetailFields(
        {
          traps: surface.traps,
          reason: surface.reason,
          answerable: surface.answerable,
          citations: surface.citations,
        },
        `${indent}  `,
      ),
    );
  }
  return lines;
}

function getSummaryGuidance(scenarios: ScenarioResult[]): string {
  // Aggregate across all evaluations, including per-surface ones in compare
  // mode. Each surface counts as its own data point for guidance purposes,
  // mirroring the run-level score aggregation.
  let trapCount = 0;
  let missingCount = 0;
  let unknownCount = 0;
  for (const result of scenarios) {
    if (result.surfaces) {
      for (const s of result.surfaces) {
        trapCount += s.traps.fired.length;
        missingCount += s.citations.missing.length;
        unknownCount += s.citations.unknown.length;
      }
      continue;
    }
    if (result.traps) trapCount += result.traps.fired.length;
    if (result.citations) {
      missingCount += result.citations.missing.length;
      unknownCount += result.citations.unknown.length;
    }
  }

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

  // AIDEV-NOTE: Without a configured threshold, render Overall and stop. Do
  // not emit run-pass/fail language. See brand.md §Interface Feedback →
  // Verdict layers: run verdict only exists when a threshold is configured.
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
        if (result.surfaces) {
          lines.push(...formatCompareBlock(result, "    "));
        } else {
          lines.push(`  ${formatResultLine(result)}`);
          lines.push(...formatDetails(result, "    "));
        }
      }

      lines.push("");
    }
  } else {
    for (const result of results) {
      lines.push(`Scenario: ${result.scenario.name}`);
      if (result.surfaces) {
        lines.push(...formatCompareBlock(result, "  "));
      } else {
        lines.push(`  ${formatResultLine(result)}`);
        lines.push(...formatDetails(result, "  "));
      }
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
