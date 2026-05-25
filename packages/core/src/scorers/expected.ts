import type { ExpectedChecks } from "@pickled-dev/config";

/** Substring-presence groups whose entries must each appear in the response. */
export type PresentGroup =
  | "includes"
  | "symbols"
  | "paths"
  | "options"
  | "constraints";

/** Substring-absence groups whose entries must NOT appear in the response. */
export type AbsentGroup = "excludes";

export interface CheckResult {
  value: string;
  satisfied: boolean;
}

export interface ExpectedDetail {
  /** Substrings that were required to appear in the response. */
  includes: CheckResult[];
  /** Substrings that were required to NOT appear. */
  excludes: CheckResult[];
  /**
   * Implementation-readiness groups (substring-presence, like `includes`).
   * Split from `includes` so the reporter can name WHAT failed: a missing
   * `symbols` entry means the agent did not name the right API, etc.
   * Scoring substrate is identical to `includes`; the split is
   * presentational.
   */
  symbols: CheckResult[];
  paths: CheckResult[];
  options: CheckResult[];
  constraints: CheckResult[];
  /** Number of declared checks satisfied (used for cell-score composition). */
  satisfied: number;
  /** Total declared checks (used for cell-score composition). */
  total: number;
}

const PRESENT_GROUPS: readonly PresentGroup[] = [
  "includes",
  "symbols",
  "paths",
  "options",
  "constraints",
];

/**
 * Evaluate deterministic substring checks against the agent's response.
 * Each `includes` / `symbols` / `paths` / `options` / `constraints` entry
 * must appear (case-sensitive substring); each `excludes` entry must be
 * absent. The grouped keys all use the same matcher as `includes`; the
 * split is presentational so the reporter can name which kind of
 * comprehension failed.
 *
 * Returns per-group satisfaction records plus aggregate counters the cell
 * scorer combines with citation / trap signals.
 */
export function scoreExpected(input: {
  response: string;
  expected?: ExpectedChecks;
}): ExpectedDetail {
  const response = input.response;
  const expected = input.expected;
  const scorePresent = (group: PresentGroup): CheckResult[] =>
    (expected?.[group] ?? []).map((value) => ({
      value,
      satisfied: response.includes(value),
    }));
  const includes = scorePresent("includes");
  const symbols = scorePresent("symbols");
  const paths = scorePresent("paths");
  const options = scorePresent("options");
  const constraints = scorePresent("constraints");
  const excludes = (expected?.excludes ?? []).map((value) => ({
    value,
    satisfied: !response.includes(value),
  }));
  const allGroups = [includes, symbols, paths, options, constraints, excludes];
  const satisfied = allGroups.reduce(
    (sum, group) => sum + group.filter((c) => c.satisfied).length,
    0,
  );
  const total = allGroups.reduce((sum, group) => sum + group.length, 0);
  return {
    includes,
    excludes,
    symbols,
    paths,
    options,
    constraints,
    satisfied,
    total,
  };
}

/**
 * Build the per-group diagnostic notes for a cell's reason string.
 * Returns one entry per group with at least one failed check (labeled
 * with the group name), or a single "expected checks satisfied (k/n)"
 * summary when nothing failed. Empty array when no checks were declared.
 *
 * Used by the cell scorer in both branches (matrix + non-matrix) so the
 * two paths emit consistent reason strings; previously each branch had
 * its own inlined includes/excludes formatter.
 */
export function formatExpectedNotes(detail: ExpectedDetail): string[] {
  if (detail.total === 0) return [];
  const missingByGroup: Array<{ label: string; misses: string[] }> = [];
  for (const group of PRESENT_GROUPS) {
    const misses = detail[group]
      .filter((c) => !c.satisfied)
      .map((c) => `"${c.value}"`);
    if (misses.length > 0) {
      missingByGroup.push({ label: `missing ${group}`, misses });
    }
  }
  const bannedHit = detail.excludes
    .filter((c) => !c.satisfied)
    .map((c) => `"${c.value}"`);
  if (bannedHit.length > 0) {
    missingByGroup.push({ label: "hit excludes", misses: bannedHit });
  }
  if (missingByGroup.length === 0) {
    return [`expected checks satisfied (${detail.satisfied}/${detail.total})`];
  }
  return [
    missingByGroup.map((g) => `${g.label}: ${g.misses.join(", ")}`).join("; "),
  ];
}
