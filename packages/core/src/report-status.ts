import type { BuildCell, QuestionCell, RunReport } from "./types.js";

/**
 * Shared status + score/threshold policy. This is the single source of truth so
 * the terminal renderer, the JSON output, and any future web surface cannot
 * drift: renderers choose formatting, never the score, the label family, or the
 * run pass/fail decision.
 *
 * Brand invariant (see brand.md verdict layers): the categorical cell `verdict`
 * determines the label family; the sampling axes (k/n, coverage) are detail and
 * never upgrade a PARTIAL/NO cell. Cell verdict and run verdict stay orthogonal.
 */

export type StatusTone = "success" | "warning" | "error";

export interface CellStatus {
  icon: string;
  label: string;
  tone: StatusTone;
  /** Trial rate "k/n" (questions: fully-grounded trials; builds: built). */
  rate: string;
  /** Extra detail, e.g. coverage for a partial question, or an unproven verifier. */
  detail?: string;
}

const ICON: Record<StatusTone, string> = {
  success: "✓",
  warning: "⚠",
  error: "✗",
};

/**
 * Question cell label, from the categorical verdict. k/n (passedTrials over
 * scored trials) is the rate; partial cells also surface mean coverage.
 */
export function questionCellStatus(cell: QuestionCell): CellStatus {
  const rate = `${cell.passedTrials}/${cell.totalTrials}`;
  if (cell.error)
    return { icon: ICON.error, label: "Error", tone: "error", rate };
  switch (cell.verdict) {
    case "YES":
      return {
        icon: ICON.success,
        label: "Well grounded",
        tone: "success",
        rate,
      };
    case "PARTIAL":
      return {
        icon: ICON.warning,
        label: "Partially grounded",
        tone: "warning",
        rate,
        detail: `${cell.meanCoverage}% facts`,
      };
    case "NO":
      return { icon: ICON.error, label: "Ungrounded", tone: "error", rate };
  }
}

/** Build cell label, from the strict k/n verdict. */
export function buildCellStatus(cell: BuildCell): CellStatus {
  const rate = `${cell.passedAttempts}/${cell.totalAttempts}`;
  if (cell.error) {
    return {
      icon: ICON.error,
      label: "Error",
      tone: "error",
      rate,
      detail:
        cell.verifierProof === "failed"
          ? "verifier broken (reference solution failed)"
          : undefined,
    };
  }
  const detail =
    cell.verifierProof === "passed"
      ? "verifier proven"
      : cell.verifierProof === "not_declared"
        ? "verifier unproven"
        : undefined;
  switch (cell.verdict) {
    case "YES":
      return {
        icon: ICON.success,
        label: "Built",
        tone: "success",
        rate,
        detail,
      };
    case "PARTIAL":
      return {
        icon: ICON.warning,
        label: "Partially built",
        tone: "warning",
        rate,
        detail,
      };
    case "NO":
      return {
        icon: ICON.error,
        label: "Did not build",
        tone: "error",
        rate,
        detail,
      };
  }
}

function mean(xs: number[]): number {
  return xs.length === 0
    ? 0
    : Math.round(xs.reduce((s, x) => s + x, 0) / xs.length);
}

/**
 * Run-score policy. Questions score on mean fact coverage (reflects partial
 * understanding); builds score on mean build pass-rate. Both over non-error
 * cells; 0 when nothing scored. The per-kind threshold gates this number.
 */
export function summarizeQuestions(
  cells: QuestionCell[],
): RunReport["summary"] {
  const scored = cells.filter((c) => c.error === undefined);
  return {
    total: cells.length,
    yes: scored.filter((c) => c.verdict === "YES").length,
    partial: scored.filter((c) => c.verdict === "PARTIAL").length,
    no: scored.filter((c) => c.verdict === "NO").length,
    errors: cells.length - scored.length,
    score: mean(scored.map((c) => c.meanCoverage)),
  };
}

export function summarizeBuilds(cells: BuildCell[]): RunReport["summary"] {
  const scored = cells.filter((c) => c.error === undefined);
  return {
    total: cells.length,
    yes: scored.filter((c) => c.verdict === "YES").length,
    partial: scored.filter((c) => c.verdict === "PARTIAL").length,
    no: scored.filter((c) => c.verdict === "NO").length,
    errors: cells.length - scored.length,
    score: mean(scored.map((c) => c.passRate)),
  };
}

/**
 * Run verdict. Returns null when no threshold is configured (renderers show the
 * score and stop, no run-pass/fail language). With a threshold, a run passes
 * iff the score meets it AND no cell errored: the score excludes error cells, so
 * a run with unscored cells has not actually been measured and must not pass CI.
 * Cell verdict and run verdict are orthogonal.
 */
export function runPasses(
  summary: RunReport["summary"],
  threshold: number | undefined,
): boolean | null {
  if (threshold === undefined) return null;
  if (summary.errors > 0) return false;
  return summary.score >= threshold;
}
