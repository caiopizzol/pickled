import type {
  ResolvedDocSource,
  Scenario,
  TargetCategory,
} from "@pickled-dev/config";
import type { Answerable } from "./scorers/index.js";
import type { ResponseEntry } from "./targets/types.js";

export type { Answerable };

export interface CitationDetails {
  cited: string[];
  required: string[];
  missing: string[];
  unknown: string[];
}

/**
 * One per-surface evaluation produced by compare-surfaces mode. Carries the
 * same shape as a single-mode ScenarioResult's evaluation fields, plus the
 * source ids that were active for this run.
 */
export interface SurfaceResult {
  active: string[];
  answerable: Answerable;
  confidence: number;
  response: string;
  reason: string;
  citations: CitationDetails;
  allResponses?: ResponseEntry[];
}

/**
 * One per-cell evaluation produced by matrix mode. A cell is the tuple
 * (agent/interface, access, source, toolset). Carries the scenario's evaluation fields
 * scoped to that cell.
 *
 * Runtime support today: `toolset = "none"` (source injected), the `web`
 * shape (`webSearch`/`webFetch` flags), and the `mcp` shape (`mcpServers`
 * map), both on Claude Code with source NOT injected (agent uses tools).
 * Other shapes (Firecrawl, native API search) throw until their adapters
 * land per release.
 */
/**
 * One build-task attempt: the outcome plus deterministic receipts. Build
 * outcomes are stochastic, so a build cell aggregates several attempts into a
 * k/n rate. Self-contained report shape; the build runner (PR 5) maps the
 * workspace/verifier primitives into it.
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
  /**
   * Per-verify-command receipt, mirroring the command verifier's CommandResult
   * so a failed command is debuggable ("read the receipt and know what
   * failed"). `stdout`/`stderr` and the attempt `diff` are stripped from
   * non-verbose JSON (see formatCheckJSON) to keep CI artifacts small.
   */
  commands?: Array<{
    name: string;
    run: string;
    exitCode: number;
    passed: boolean;
    stdout: string;
    stderr: string;
    timedOut: boolean;
  }>;
  /** Path to the retained workspace when keep-on-failure kept it. */
  workspaceKeptPath?: string;
}

export interface CellResult {
  cell: {
    interface: string;
    access?: string;
    source: string | null;
    toolset: string;
  };
  /**
   * Which task produced this cell. Inert for answer cells; build cells set
   * "build" so JSON consumers can identify them even when an error left no
   * `build` block. Distinct from `PlannedCell.kind` ("matrix" | "single"),
   * which is a planning coordinate, not the task type.
   */
  taskKind?: "answer" | "build";
  answerable: Answerable;
  confidence: number;
  response: string;
  reason: string;
  citations: CitationDetails | null;
  expected?: {
    includes: Array<{ value: string; satisfied: boolean }>;
    excludes: Array<{ value: string; satisfied: boolean }>;
    /**
     * Implementation-readiness groups. Each is scored with the same
     * substring-presence matcher as `includes`; the split records WHAT
     * kind of comprehension failed for the readiness reporter to
     * surface. Empty arrays when the scenario did not declare the group.
     */
    symbols: Array<{ value: string; satisfied: boolean }>;
    paths: Array<{ value: string; satisfied: boolean }>;
    options: Array<{ value: string; satisfied: boolean }>;
    constraints: Array<{ value: string; satisfied: boolean }>;
    mustMentionOneOf: Array<{
      label: string;
      values: string[];
      satisfied: boolean;
      matched: string[];
    }>;
    satisfied: number;
    total: number;
  };
  /**
   * Tools the agent invoked during the cell run, captured by the target
   * adapter from the underlying agent's tool_use events. Empty for `none`
   * cells; populated for cells with tool-enabled toolsets (e.g., `web`).
   * Provenance evidence the cell can be inspected against.
   */
  toolsUsed?: string[];
  /** Set when the cell run threw; answerable will be NO, confidence 0. */
  error?: string;
  allResponses?: ResponseEntry[];
  /**
   * Build-task evidence (kind: build cells only). Answer cells leave this
   * undefined and keep the answerable/confidence verdict, which still drives
   * summary math and thresholds for both modes. `build` carries the k/n pass
   * rate plus per-attempt receipts; the reporter renders it as build language
   * (Built 2/3, Partially built 1/3, Did not build 0/3). Attempts are evidence
   * for stochastic build tasks, NOT a universal result container - answer cells
   * are never reshaped into attempts.
   */
  build?: {
    attempts: BuildAttempt[];
    passedAttempts: number;
    totalAttempts: number;
  };
}

export interface ScenarioResult {
  scenario: Scenario;
  /**
   * Top-level evaluation fields. In compare mode (when `surfaces` is set per
   * `scenario.compareSurfaces`), these are `null` and `surfaces[]` is the
   * source of truth. Consumers must check for `surfaces` first.
   */
  answerable: Answerable | null;
  confidence: number | null;
  response: string | null;
  reason: string | null;
  citations: CitationDetails | null;
  /** Per-surface evaluations. Present iff scenario.compareSurfaces declared. */
  surfaces?: SurfaceResult[];
  /** Per-cell evaluations. Present iff scenario.matrix declared. */
  cells?: CellResult[];
  /**
   * Per-group expected-check breakdown for single-mode runs. Mirrors the
   * `CellResult.expected` shape so a future reader (readiness reporter,
   * downstream tooling) can consume single-mode and matrix results
   * uniformly. Absent in compare mode (surfaces own the verdict there)
   * and absent in matrix mode (cells own it there).
   */
  expected?: {
    includes: Array<{ value: string; satisfied: boolean }>;
    excludes: Array<{ value: string; satisfied: boolean }>;
    symbols: Array<{
      value: string;
      satisfied: boolean;
      existsInCodebase?: boolean | null;
    }>;
    paths: Array<{
      value: string;
      satisfied: boolean;
      existsInCodebase?: boolean | null;
    }>;
    options: Array<{ value: string; satisfied: boolean }>;
    constraints: Array<{ value: string; satisfied: boolean }>;
    mustMentionOneOf: Array<{
      label: string;
      values: string[];
      satisfied: boolean;
      matched: string[];
    }>;
    satisfied: number;
    total: number;
  };
  /**
   * Verifier source snapshots surfaced for human review. Present iff
   * scenario.verifiers.sources is declared and the referenced sources
   * loaded successfully. NEVER LLM-judged; NEVER injected into the agent's
   * prompt unless also listed as the cell's active source.
   */
  verifierSamples?: Array<{ id: string; name: string; content: string }>;
  error?: string;
  target?: {
    target: string;
    category: TargetCategory;
    provider: string;
    model: string;
  };
  context?: {
    name: string;
  };
  toolsUsed?: string[];
  sources?: string[];
  allResponses?: ResponseEntry[];
}

export interface CheckReport {
  tool: {
    name: string;
    description: string;
    path: string;
  };
  docs: ResolvedDocSource[];
  scenarios: ScenarioResult[];
  summary: {
    total: number;
    answered: number;
    unanswered: number;
    score: number;
  };
  /**
   * Implementation-readiness diagnostics derived from scenario results.
   * Pure function of the rest of the report; #22 / step 4 of #19.
   * Reads existing fields (grouped expected, existence flags, axis
   * comparisons); does not change scoring. Absent when no diagnostic
   * pattern applied.
   */
  readiness?: {
    diagnostics: Array<{
      pattern:
        | "grouped_check_pass"
        | "source_comparison"
        | "toolset_comparison"
        | "interface_comparison";
      message: string;
      scenario: string;
      cells: Array<{
        interface: string;
        access?: string;
        source: string | null;
        toolset: string;
      }>;
    }>;
  };
  /**
   * Cell counts and sampling provenance for a run. `expandedCells` is the
   * count after `--task` / `--agent` / `--access` filters but before
   * sampling. `selectedCells` is the count after
   * sampling (equal to `expandedCells` when `--sample` was not passed).
   * `seed` is recorded only when sampling was active.
   */
  plan?: {
    expandedCells: number;
    selectedCells: number;
    /**
     * Trial-expanded execution counts. A build cell runs `trials` agent runs,
     * so executions >= cells; for answer-only runs they are equal. This is the
     * real unit of work, and what `--max-cells` gates.
     */
    expandedExecutions?: number;
    selectedExecutions?: number;
    seed?: string;
    /** Per-cell list, included only in dry-run reports (`--plan`). */
    cells?: Array<{
      scenario: string;
      interface?: string;
      access?: string;
      source?: string | null;
      toolset?: string;
      target?: string;
      context?: string;
      /** Executions for this cell (build cells only; absent means 1). */
      trials?: number;
    }>;
  };
}

export interface ToolInfo {
  name: string;
  description: string;
  path: string;
}
