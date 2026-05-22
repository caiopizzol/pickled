import type { Answerable, TrapDetails } from "./scorers/index.js";

/**
 * One source of truth for how an evaluation maps to a user-facing label.
 *
 * The scenario verdict (answerable + trap state) determines the label family.
 * Confidence only refines YES into Well grounded vs Grounded. Confidence must
 * never upgrade PARTIAL, NO, Trap fired, or Error into a stronger label.
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
  traps: TrapDetails;
  error?: string;
}

export function getScenarioStatus(input: Scoreable): ScenarioStatus {
  const confidence = input.confidence;

  if (input.error) {
    return { icon: "✗", label: "Error", confidence, tone: "error" };
  }

  if (input.traps.fired.length > 0) {
    return { icon: "✗", label: "Trap fired", confidence, tone: "error" };
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
