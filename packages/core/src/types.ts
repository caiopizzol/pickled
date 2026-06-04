import type {
  Context,
  Fact,
  Misstatement,
  ResolvedSource,
} from "@pickled-dev/config";
import type { ResponseEntry } from "./targets/types.js";

export type { ResolvedSource };

/** Categorical cell verdict, shared by questions and builds (the machine field). */
export type Verdict = "YES" | "PARTIAL" | "NO";

/** A cell coordinate: which agent answered, down which context path. */
export interface CellCoord {
  agent: string;
  context: string;
}

/**
 * Runtime product handle. `path` is the project directory: the cwd for relative
 * source loading and the root build fixtures resolve against. (Named ToolInfo
 * because the adapters consume it as-is; the product noun is "product".)
 */
export interface ToolInfo {
  name: string;
  description: string;
  path: string;
}

// ---- Question receipts ----

/**
 * One scored trial of a question cell. The verdict is coverage-driven with a
 * hard veto: a misstatement hit or a provenance failure forces NO regardless
 * of how many facts were covered. Fact/misstatement entries are ids; resolve
 * their statements via the registries on RunReport.
 */
export interface ScoredTrial {
  status: "scored";
  verdict: Verdict;
  /** verdict === "YES": a fully-satisfied trial (all expects covered, no veto). */
  passed: boolean;
  /** Fact coverage 0-100 (covered / total expects; 100 when no expects). */
  coverage: number;
  factsCovered: string[];
  factsMissed: string[];
  /** Misstatement ids that fired. Non-empty => hard veto => verdict NO. */
  misstatementsHit: string[];
  /** Whether the expected tool path was used. Always true for memory/inject. */
  provenanceOk: boolean;
  toolsUsed: string[];
  response: string;
  allResponses?: ResponseEntry[];
}

/** A trial that threw (environment/agent crash). Excluded from cell scoring. */
export interface ErrorTrial {
  status: "error";
  error: string;
  reason?: string;
  response?: string;
  allResponses?: ResponseEntry[];
}

export type QuestionTrial = ScoredTrial | ErrorTrial;

/**
 * A question cell: one (agent x context), one or more trials, with a derived
 * verdict plus the two sampling axes. `passedTrials/totalTrials` is the strict
 * full-pass count (verdict YES); `meanCoverage` explains partial understanding.
 * The k/n syntax is shared with build cells but reads in a different label
 * family: for questions k/n is "fully grounded trials," for builds it is "built."
 *
 * Aggregation (computed by the scorer over scored trials): YES iff every scored
 * trial is YES; PARTIAL if any is YES or PARTIAL but not all are YES; NO if
 * every scored trial is NO. `meanCoverage` averages coverage across scored
 * trials, with vetoed/provenance-failed trials counting 0. A cell whose trials
 * all errored sets `error` and is counted under summary.errors, not a verdict.
 */
export interface QuestionCell {
  coord: CellCoord;
  mode: Context["mode"];
  /** Source id when the context names one (always for inject; optional web/mcp). */
  source: string | null;
  verdict: Verdict;
  /** Trials whose verdict is YES. */
  passedTrials: number;
  /** Scored trials (error trials excluded from the denominator). */
  totalTrials: number;
  /** passedTrials / totalTrials * 100. */
  passRate: number;
  /** Mean fact coverage across scored trials; vetoed trials count 0. */
  meanCoverage: number;
  trials: QuestionTrial[];
  reason: string;
  /** Set when the cell could not be scored (every trial errored). */
  error?: string;
}

export interface QuestionResult {
  id: string;
  question: string;
  cells: QuestionCell[];
}

// ---- Build receipts ----

/** Which verifier group a command belongs to. */
export type VerifierGroup = "failToPass" | "passToPass";

export interface CommandReceipt {
  group: VerifierGroup;
  name: string;
  run: string;
  exitCode: number;
  passed: boolean;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/**
 * One build-task attempt: the outcome plus deterministic receipts. Build
 * outcomes are stochastic, so a build cell aggregates attempts into a k/n rate.
 * `stdout`/`stderr` and `diff` are stripped from non-verbose JSON.
 */
export interface BuildAttempt {
  status: "passed" | "failed" | "error";
  /**
   * Build-language reason on a non-pass: empty diff, the baseline test harness
   * was modified, a failing verify command, or a setup/environment error.
   */
  reason?: string;
  changedFiles?: Array<{ status: string; path: string; oldPath?: string }>;
  diff?: string;
  commands?: CommandReceipt[];
  /** Path to the retained workspace when keep-on-failure kept it. */
  workspaceKeptPath?: string;
}

/**
 * Whether the optional positive control ran and what it showed. `passed` =
 * the reference solution cleared the verifier on the baseline (bar reachable).
 * `failed` = it did not, so the verifier itself is broken (distinct from the
 * agent failing). `not_declared` = no reference solution; verifier unproven.
 */
export type VerifierProof = "not_declared" | "passed" | "failed";

/**
 * A build cell: one (agent x context), `trials` attempts, strict k/n verdict.
 */
export interface BuildCell {
  coord: CellCoord;
  mode: Context["mode"];
  source: string | null;
  verdict: Verdict;
  passedAttempts: number;
  totalAttempts: number;
  passRate: number;
  attempts: BuildAttempt[];
  reason: string;
  verifierProof: VerifierProof;
  /** Set when the cell could not be scored (setup error, vacuous fixture, all attempts errored). */
  error?: string;
}

export interface BuildResult {
  id: string;
  goal: string;
  cells: BuildCell[];
}

// ---- The run report (the receipt the renderers consume) ----

export interface PlanSummary {
  expandedCells: number;
  selectedCells: number;
  /** Trial-expanded execution counts (a build/question cell runs `trials` agent runs). */
  expandedExecutions: number;
  selectedExecutions: number;
  seed?: string;
  /** Per-cell list, included only in dry-run (`--plan`) reports. */
  cells?: Array<{
    task: string;
    agent: string;
    context: string;
    /** Executions for this cell when > 1 (trials). */
    trials?: number;
  }>;
}

/**
 * The structured receipt for one run. A run is single-kind: `pickled check`
 * produces `kind: "questions"`, `pickled build` produces `kind: "builds"`.
 * Renderers (terminal, JSON, markdown) are pure functions of this. The
 * `facts`/`misstatements` registries make the receipt self-contained: trial
 * ids resolve to statements without reloading the config.
 */
export interface RunReport {
  product: { name: string; description: string };
  sources: ResolvedSource[];
  facts: Record<string, Fact>;
  misstatements: Record<string, Misstatement>;
  kind: "questions" | "builds";
  questions?: QuestionResult[];
  builds?: BuildResult[];
  summary: {
    /** All cells (yes + partial + no + errors). */
    total: number;
    yes: number;
    partial: number;
    no: number;
    errors: number;
    /** Overall 0-100 score for the run's kind. */
    score: number;
  };
  threshold?: number;
  plan?: PlanSummary;
}
