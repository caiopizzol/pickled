import type {
  ResolvedDocSource,
  Scenario,
  TargetCategory,
} from "@pickled-dev/config";
import type { Answerable, TrapDetails } from "./scorers/index.js";
import type { ResponseEntry } from "./targets/types.js";

export type { Answerable, TrapDetails };

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
  traps: TrapDetails;
  allResponses?: ResponseEntry[];
}

/**
 * One per-cell evaluation produced by matrix mode. A cell is the tuple
 * (interface, source, toolset). Carries the scenario's evaluation fields
 * scoped to that cell. See `proposals/matrix-evaluation.md`.
 *
 * v0.16.0: only `toolset = "none"` has runtime behavior (source content is
 * injected). Non-none toolsets throw at runtime; their adapter implementations
 * (WebSearch+WebFetch, Context7 MCP, Firecrawl, etc.) land in follow-up
 * commits.
 */
export interface CellResult {
  cell: {
    interface: string;
    source: string | null;
    toolset: string;
  };
  answerable: Answerable;
  confidence: number;
  response: string;
  reason: string;
  citations: CitationDetails | null;
  traps: TrapDetails;
  expected?: {
    includes: Array<{ value: string; satisfied: boolean }>;
    excludes: Array<{ value: string; satisfied: boolean }>;
    satisfied: number;
    total: number;
  };
  allResponses?: ResponseEntry[];
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
  traps: TrapDetails | null;
  /** Per-surface evaluations. Present iff scenario.compareSurfaces declared. */
  surfaces?: SurfaceResult[];
  /** Per-cell evaluations. Present iff scenario.matrix declared. */
  cells?: CellResult[];
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
}

export interface ToolInfo {
  name: string;
  description: string;
  path: string;
}
