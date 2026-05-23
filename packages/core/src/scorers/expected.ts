import type { ExpectedChecks } from "@pickled-dev/config";

export interface ExpectedDetail {
  /** Substrings that were required to appear in the response, in order. */
  includes: Array<{ value: string; satisfied: boolean }>;
  /** Substrings that were required to NOT appear. */
  excludes: Array<{ value: string; satisfied: boolean }>;
  /** Number of declared checks satisfied (used for cell-score composition). */
  satisfied: number;
  /** Total declared checks (used for cell-score composition). */
  total: number;
}

/**
 * Evaluate deterministic substring checks against the agent's response.
 * Each include must appear (case-sensitive substring); each exclude must
 * be absent. Returns a per-check satisfaction record plus aggregate
 * counters the cell scorer combines with citation / trap signals.
 */
export function scoreExpected(input: {
  response: string;
  expected?: ExpectedChecks;
}): ExpectedDetail {
  const expected = input.expected;
  const includes = (expected?.includes ?? []).map((value) => ({
    value,
    satisfied: input.response.includes(value),
  }));
  const excludes = (expected?.excludes ?? []).map((value) => ({
    value,
    satisfied: !input.response.includes(value),
  }));
  const satisfied =
    includes.filter((c) => c.satisfied).length +
    excludes.filter((c) => c.satisfied).length;
  const total = includes.length + excludes.length;
  return { includes, excludes, satisfied, total };
}
