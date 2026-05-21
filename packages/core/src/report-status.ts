import type { ScenarioResult } from "./types.js";

/**
 * One source of truth for how a ScenarioResult maps to a user-facing label.
 *
 * The scenario verdict (answerable + trap state) determines the label family.
 * Confidence only refines YES into Well grounded vs Grounded. Confidence must
 * never upgrade PARTIAL, NO, Trap fired, or Error into a stronger label.
 *
 * Callers handle their own formatting (chalk colors, percent suffix, etc.).
 * This helper returns raw values so it stays portable across CLI, JSON, and
 * web surfaces.
 */

export type StatusTone = "success" | "warning" | "error";

export interface ScenarioStatus {
  icon: string;
  label: string;
  confidence: number;
  tone: StatusTone;
}

export function getScenarioStatus(result: ScenarioResult): ScenarioStatus {
  const confidence = result.confidence;

  if (result.error) {
    return { icon: "✗", label: "Error", confidence, tone: "error" };
  }

  if (result.traps.fired.length > 0) {
    return { icon: "✗", label: "Trap fired", confidence, tone: "error" };
  }

  if (result.answerable === "YES") {
    const label = confidence >= 90 ? "Well grounded" : "Grounded";
    return { icon: "✓", label, confidence, tone: "success" };
  }

  if (result.answerable === "PARTIAL") {
    return {
      icon: "⚠",
      label: "Partially grounded",
      confidence,
      tone: "warning",
    };
  }

  return { icon: "✗", label: "Ungrounded", confidence, tone: "error" };
}
