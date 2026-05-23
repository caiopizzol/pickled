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
 * Runtime support today: `toolset = "none"` (source injected) and the
 * `web` shape (`webSearch`/`webFetch` flags) on Claude Code (source not
 * injected; agent uses tools). Other toolsets throw until their adapters
 * (Context7 MCP, Firecrawl, native API search) land per release.
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
