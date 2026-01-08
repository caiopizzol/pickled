import type { Answerable } from "./types.js";

export interface ValidationResult {
  answerable: Answerable;
  confidence: number;
  reason: string;
  missing?: string[];
}

export function parseValidation(response: string): ValidationResult {
  // Try to parse JSON block from response
  const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1]);
      return normalizeResult(parsed);
    } catch {
      // Fall through to text parsing
    }
  }

  // Try to parse raw JSON
  try {
    const parsed = JSON.parse(response);
    return normalizeResult(parsed);
  } catch {
    // Fall through to heuristic
  }

  // Heuristic based on response content
  return inferFromResponse(response);
}

function normalizeResult(parsed: Record<string, unknown>): ValidationResult {
  const answerable = normalizeAnswerable(parsed.answerable);
  const confidence = normalizeConfidence(parsed.confidence);
  const reason = String(parsed.reason || "");
  const missing = Array.isArray(parsed.missing)
    ? parsed.missing.map(String)
    : undefined;

  return { answerable, confidence, reason, missing };
}

function normalizeAnswerable(value: unknown): Answerable {
  const str = String(value).toUpperCase();
  if (str === "YES" || str === "TRUE") return "YES";
  if (str === "PARTIAL" || str === "MAYBE") return "PARTIAL";
  return "NO";
}

function normalizeConfidence(value: unknown): number {
  const num = Number(value);
  if (Number.isNaN(num)) return 50;
  // If 0-1 range, convert to 0-100
  if (num >= 0 && num <= 1) return Math.round(num * 100);
  // Clamp to 0-100
  return Math.max(0, Math.min(100, Math.round(num)));
}

function inferFromResponse(response: string): ValidationResult {
  const lower = response.toLowerCase();

  // Check for negative indicators
  const hasNegative =
    lower.includes("cannot find") ||
    lower.includes("not documented") ||
    lower.includes("no documentation") ||
    lower.includes("unable to") ||
    lower.includes("don't have information");

  // Check for partial indicators
  const hasPartial =
    lower.includes("partially") ||
    lower.includes("some information") ||
    lower.includes("limited documentation");

  if (hasNegative) {
    return {
      answerable: "NO",
      confidence: 30,
      reason: "Unable to find relevant documentation",
    };
  }

  if (hasPartial) {
    return {
      answerable: "PARTIAL",
      confidence: 60,
      reason: "Found some relevant information",
    };
  }

  // Default to YES if response seems substantive
  if (response.length > 100) {
    return {
      answerable: "YES",
      confidence: 70,
      reason: "Found relevant information",
    };
  }

  return {
    answerable: "PARTIAL",
    confidence: 50,
    reason: "Unable to determine answer quality",
  };
}
