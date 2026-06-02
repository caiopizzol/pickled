import type { Answerable } from "./scorers/index.js";

/**
 * One source of truth for how an evaluation maps to a user-facing label.
 *
 * The question verdict (answerable) determines the label family. Confidence
 * only refines YES into Well grounded vs Grounded. Confidence must never
 * upgrade PARTIAL, NO, or Error into a stronger label.
 *
 * Callers handle their own formatting (chalk colors, percent suffix, etc.).
 * This helper returns raw values so it stays portable across CLI, JSON, and
 * web surfaces.
 *
 * The input is a structural Scoreable rather than ScenarioResult so the same
 * helper labels both single-mode results and compare-mode SurfaceResult
 * entries.
 */

export type StatusTone = "success" | "warning" | "error";

export interface ScenarioStatus {
  icon: string;
  label: string;
  confidence: number;
  tone: StatusTone;
}

export interface Scoreable {
  answerable: Answerable;
  confidence: number;
  error?: string;
}

export function getScenarioStatus(input: Scoreable): ScenarioStatus {
  const confidence = input.confidence;

  if (input.error) {
    return { icon: "✗", label: "Error", confidence, tone: "error" };
  }

  if (input.answerable === "YES") {
    const label = confidence >= 90 ? "Well grounded" : "Grounded";
    return { icon: "✓", label, confidence, tone: "success" };
  }

  if (input.answerable === "PARTIAL") {
    return {
      icon: "⚠",
      label: "Partially grounded",
      confidence,
      tone: "warning",
    };
  }

  return { icon: "✗", label: "Ungrounded", confidence, tone: "error" };
}

/**
 * Build-cell label. Build cells score as a k/n pass rate over trials, not the
 * answer-mode grounded scale, so they get their own language and never render
 * as "Well grounded". `confidence` carries the pass rate as a percent for
 * non-CLI surfaces; the CLI reporter shows the literal k/n. An errored build
 * cell (setup or vacuous-fixture) carries `error` and no `build` block, so it
 * falls through to getScenarioStatus and renders "Error".
 */
export function getBuildStatus(build: {
  passedAttempts: number;
  totalAttempts: number;
}): ScenarioStatus {
  const { passedAttempts: passed, totalAttempts: total } = build;
  const confidence = total > 0 ? Math.round((passed / total) * 100) : 0;
  if (total > 0 && passed === total) {
    return { icon: "✓", label: "Built", confidence, tone: "success" };
  }
  if (passed > 0) {
    return { icon: "⚠", label: "Partially built", confidence, tone: "warning" };
  }
  return { icon: "✗", label: "Did not build", confidence, tone: "error" };
}
