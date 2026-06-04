import type { Fact, Match, Misstatement } from "@pickled-dev/config";
import type {
  CellCoord,
  QuestionCell,
  QuestionTrial,
  ScoredTrial,
  Verdict,
} from "../types.js";

/** Normalize for matching: case-fold + collapse whitespace, so phrasing (not casing) decides. */
function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * A match is satisfied iff every declared `allOf` substring is present AND,
 * when `anyOf` is declared, at least one `anyOf` substring is present. Matching
 * is normalized. The validator guarantees at least one side is declared.
 */
export function matchSatisfied(response: string, match: Match): boolean {
  const hay = normalize(response);
  const allOk = (match.allOf ?? []).every((n) => hay.includes(normalize(n)));
  const anyOk =
    match.anyOf === undefined ||
    match.anyOf.some((n) => hay.includes(normalize(n)));
  return allOk && anyOk;
}

export interface ScoreTrialInput {
  response: string;
  toolsUsed: string[];
  /** Fact ids the question expects (coverage). */
  expects: string[];
  /** Misstatement ids the question rejects (hard veto). */
  rejects: string[];
  facts: Record<string, Fact>;
  misstatements: Record<string, Misstatement>;
  /** Provenance gate (web/mcp). hasMatchers false => no tool path to prove. */
  provenance: { hasMatchers: boolean; match: (t: string) => boolean };
}

/**
 * Score one question trial: coverage-driven verdict with a hard veto. A
 * misstatement hit or a provenance failure forces NO regardless of coverage.
 * A rejects-only question (no expects) with no hit and provenance ok is YES.
 */
export function scoreQuestionTrial(input: ScoreTrialInput): ScoredTrial {
  const { response, toolsUsed, expects, rejects, facts, misstatements } = input;

  const factsCovered: string[] = [];
  const factsMissed: string[] = [];
  for (const id of expects) {
    const f = facts[id];
    if (f && matchSatisfied(response, f.match)) factsCovered.push(id);
    else factsMissed.push(id);
  }

  const misstatementsHit = rejects.filter((id) => {
    const m = misstatements[id];
    return m ? matchSatisfied(response, m.match) : false;
  });

  const provenanceOk =
    !input.provenance.hasMatchers ||
    toolsUsed.some((t) => input.provenance.match(t));

  const coverage =
    expects.length === 0
      ? 100
      : Math.round((factsCovered.length / expects.length) * 100);

  const vetoed = misstatementsHit.length > 0 || !provenanceOk;
  let verdict: Verdict;
  if (vetoed) verdict = "NO";
  else if (factsCovered.length === expects.length) verdict = "YES";
  else if (factsCovered.length === 0) verdict = "NO";
  else verdict = "PARTIAL";

  return {
    status: "scored",
    verdict,
    passed: verdict === "YES",
    coverage,
    factsCovered,
    factsMissed,
    misstatementsHit,
    provenanceOk,
    toolsUsed,
    response,
  };
}

/**
 * Aggregate a cell's trials into the QuestionCell verdict and the two sampling
 * axes. Verdict: YES iff every scored trial is YES; NO iff every scored trial
 * is NO; else PARTIAL. `meanCoverage` averages coverage over scored trials,
 * counting vetoed/provenance-failed trials as 0. A cell with no scored trials
 * (all errored) carries `error` and is counted under summary.errors.
 */
export function aggregateQuestionCell(args: {
  coord: CellCoord;
  mode: QuestionCell["mode"];
  source: string | null;
  trials: QuestionTrial[];
}): QuestionCell {
  const { coord, mode, source, trials } = args;
  const scored = trials.filter((t): t is ScoredTrial => t.status === "scored");

  if (scored.length === 0) {
    const firstErr = trials.find((t) => t.status === "error");
    return {
      coord,
      mode,
      source,
      verdict: "NO",
      passedTrials: 0,
      totalTrials: 0,
      passRate: 0,
      meanCoverage: 0,
      trials,
      reason: "all trials errored",
      error:
        firstErr && firstErr.status === "error"
          ? firstErr.error
          : "no scored trials",
    };
  }

  const totalTrials = scored.length;
  const passedTrials = scored.filter((t) => t.passed).length;
  const passRate = Math.round((passedTrials / totalTrials) * 100);
  const meanCoverage = Math.round(
    scored.reduce((sum, t) => {
      const vetoed = t.misstatementsHit.length > 0 || !t.provenanceOk;
      return sum + (vetoed ? 0 : t.coverage);
    }, 0) / totalTrials,
  );

  const verdict: Verdict = scored.every((t) => t.verdict === "YES")
    ? "YES"
    : scored.every((t) => t.verdict === "NO")
      ? "NO"
      : "PARTIAL";

  return {
    coord,
    mode,
    source,
    verdict,
    passedTrials,
    totalTrials,
    passRate,
    meanCoverage,
    trials,
    reason: buildCellReason(scored, verdict),
  };
}

function buildCellReason(scored: ScoredTrial[], verdict: Verdict): string {
  const missedFacts = unique(scored.flatMap((t) => t.factsMissed));
  const hitMiss = unique(scored.flatMap((t) => t.misstatementsHit));
  const provFail = scored.some((t) => !t.provenanceOk);
  const parts: string[] = [];
  if (hitMiss.length > 0) parts.push(`misstatement: ${hitMiss.join(", ")}`);
  if (provFail) parts.push("tool path not used (provenance)");
  if (missedFacts.length > 0) {
    parts.push(`missing facts: ${missedFacts.join(", ")}`);
  }
  if (parts.length === 0) {
    return verdict === "YES" ? "all expected facts covered" : "scored";
  }
  return parts.join("; ");
}

function unique(xs: string[]): string[] {
  return [...new Set(xs)];
}
