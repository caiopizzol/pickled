// Target categories for different LLM interaction modes
export type TargetCategory = "api" | "cli" | "ide";

// Providers by category
export type ApiProvider = "anthropic" | "openai" | "google";
export type CliProvider = "claude-code" | "codex-cli" | "amazon-q";
export type IdeProvider = "cursor" | "copilot" | "windsurf";

export interface McpServerConfig {
  type?: "stdio" | "sse" | "http";
  command?: string;
  args?: string[];
  url?: string;
  headers?: Record<string, string>;
}

/**
 * Target definition - reusable LLM interface configuration
 *
 * For CLI targets (claude-code), these options map to the Claude Agent SDK Options:
 * @see https://platform.claude.com/docs/en/agent-sdk/typescript
 */
export interface Target {
  category: TargetCategory;
  provider: string;

  /**
   * Model to use. For claude-code, accepts:
   * - Aliases: "sonnet", "opus", "haiku", "sonnet[1m]", "opusplan"
   * - Full names: "claude-sonnet-4-5-20250929", "claude-opus-4-20250514"
   * @default "sonnet"
   */
  model?: string;

  // === CLI-specific options (claude-code via Agent SDK) ===

  /**
   * List of tool names that are allowed.
   * @see SDK Options.allowedTools
   */
  allowedTools?: string[];

  /**
   * List of tool names that are disallowed.
   * @see SDK Options.disallowedTools
   */
  disallowedTools?: string[];

  /**
   * MCP server configurations.
   * @see SDK Options.mcpServers
   */
  mcpServers?: Record<string, McpServerConfig>;

  /**
   * Permission mode for the session.
   * @see SDK Options.permissionMode
   */
  permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan";

  /**
   * Maximum number of conversation turns.
   * @see SDK Options.maxTurns
   */
  maxTurns?: number;

  /**
   * Maximum tokens for the thinking/reasoning process.
   * @see SDK Options.maxThinkingTokens
   */
  maxThinkingTokens?: number;

  /**
   * Maximum budget in USD for the query.
   * @see SDK Options.maxBudgetUsd
   */
  maxBudgetUsd?: number;

  // === API-specific options (future) ===

  /** Temperature for API calls */
  temperature?: number;

  /** Max tokens for API calls */
  maxTokens?: number;

  // === IDE-specific options (future) ===

  /** Whether to include workspace context */
  workspaceContext?: boolean;

  // === Pickled-specific ===

  /** Per-target threshold for passing */
  threshold?: number;
}

// Context definition - reusable capability configuration
export interface Context {
  allowedTools?: string[];
  disallowedTools?: string[];
  mcpServers?: Record<string, McpServerConfig>;
}

/**
 * A trap declares a plausible-wrong answer the agent might confidently produce.
 * Firing any trap forces the result to NO regardless of citation score.
 *
 * Exactly one of `match` (literal substring, case-sensitive) or `pattern`
 * (regex source) must be set. `flags` is only valid with `pattern`.
 */
export interface Trap {
  id: string;
  reason: string;
  match?: string;
  pattern?: string;
  flags?: string;
  /**
   * Severity when this trap matches a registered source via audit
   * cross-reference. Defaults to "warning". Check-time semantics are
   * unchanged: trap firing in an agent response always forces NO with
   * confidence 0, regardless of this field.
   */
  auditSeverity?: "warning" | "error";
}

/**
 * Toolset profile. Names a tool configuration the matrix can iterate over.
 * `none` is the deterministic baseline cell (pickled injects sources; agent
 * has no tools). The `web` shape (`webSearch`/`webFetch` flags) runs on
 * Claude Code (client `WebSearch`/`WebFetch`), the Anthropic API target
 * (server-side `web_search`), and the OpenAI API target (server-side
 * `web_search`); the `mcp` shape (`mcpServers` map) runs on Claude Code
 * (Agent SDK native) and on the OpenAI API target (hosted-MCP on
 * `responses.create`, HTTP transports only). Pickled has no server-
 * specific knowledge (Context7 is a dogfood example, not a special case).
 * Other shapes (Firecrawl, native search on additional providers) are
 * recognized by the loader; their adapters land per release.
 */
export interface ToolsetConfig {
  /** Reserved for future tool flags; `none` is `{}`. */
  webSearch?: boolean;
  webFetch?: boolean;
  mcpServers?: Record<string, McpServerConfig>;
}

/**
 * Matrix declaration on a scenario. Expands the scenario into one cell per
 * (interface × source × toolset) combination. Each cell becomes one
 * evaluation in the report.
 */
export interface ScenarioMatrix {
  interfaces?: string[];
  sources?: string[];
  toolsets?: string[];
}

/**
 * Deterministic substring checks the cell must satisfy. Each entry is a
 * literal substring of the agent's response. Strings only today; a regex
 * shape may follow.
 */
export interface ExpectedChecks {
  includes?: string[];
  excludes?: string[];
  /**
   * Implementation-readiness groups. Each is scored with the SAME
   * deterministic substring matcher as `includes`; the split is
   * presentational so the reporter can say WHAT kind of comprehension
   * failed (a missing `symbols` entry means the agent did not name the
   * right API; a missing `options` entry means the agent did not name
   * the required config field; etc.).
   *
   * These do NOT buy semantic grading. `constraints` is not "the agent
   * understood the ordering rule"; it is "the agent's response contains
   * the substring you declared as a constraint." Use the labels for
   * diagnosis; do not claim more than substring presence in vendor docs.
   *
   * Back-compatible: omit any/all of these to score only `includes` /
   * `excludes` exactly as before. See issue #19 for the design.
   */
  symbols?: string[];
  paths?: string[];
  options?: string[];
  constraints?: string[];
}

/**
 * Verifier sources are loaded at run time and surfaced side-by-side in the
 * report for HUMAN review only. They are never injected into the agent's
 * prompt unless they also appear in the cell's active source. They are
 * never LLM-judged.
 */
export interface VerifierConfig {
  sources?: string[];
}

// Scenario - a test case
export interface Scenario {
  name: string;
  prompt: string;
  target?: string; // Reference to named target
  context?: string; // Reference to named context

  /**
   * Source IDs (from docs.sources) the answer must cite. Use `[]` to allow
   * any registered source as a valid citation without requiring a specific
   * one. Omit entirely to skip citation scoring (matrix scenarios that
   * score on `expected` or `traps` instead). At least one of
   * `requiredSources`, `expected`, `traps`, or `compareSurfaces` must be
   * declared on the scenario. Non-none matrix cells skip citation scoring
   * because the source is not injected, so they need `expected` or `traps`
   * regardless of whether `requiredSources` is also set.
   */
  requiredSources?: string[];

  /**
   * Optional traps. Each is a deterministic stale-answer detector; firing
   * any trap forces the scenario to NO with confidence 0.
   */
  traps?: Trap[];

  /**
   * Compare-surfaces mode. Each entry is a list of source IDs forming
   * one surface. The scenario runs once per declared surface, with only
   * those sources visible to the agent. Per-surface results live in
   * `ScenarioResult.surfaces[]`; the top-level evaluation fields are
   * `null` when this is set.
   */
  compareSurfaces?: string[][];

  /**
   * Matrix declaration. When set, the scenario runs once per cell formed
   * by (interfaces × sources × toolsets). Per-cell results live in
   * `ScenarioResult.cells[]`; top-level evaluation fields are `null`.
   */
  matrix?: ScenarioMatrix;

  /**
   * Deterministic substring checks applied to the agent's response.
   * Contributes to per-cell scoring alongside traps and citation scoring.
   */
  expected?: ExpectedChecks;

  /**
   * Verifier configuration. Sources listed here are loaded at run time and
   * surfaced side-by-side in the report for human review. Never injected
   * into the agent's prompt; never LLM-judged.
   */
  verifiers?: VerifierConfig;
}

export type DocSourceType = "url" | "file" | "codebase";

export interface DocSource {
  content: string;
  name: string;
  type: DocSourceType;
}

/**
 * Object form of a docs.sources entry. Allows per-source audit metadata,
 * source-type selection, and codebase glob options alongside the file path
 * or URL. The plain string form (just the path) stays valid and is the
 * default for single-file or single-URL sources.
 */
export interface DocSourceEntry {
  path: string;
  /**
   * Source loader to use. Default (when omitted) is to auto-detect file vs
   * URL based on the path prefix. Set explicitly to `codebase` to treat
   * `path` as a glob and load every matching file as one logical source.
   */
  type?: "file" | "url" | "codebase";
  /**
   * Exclude patterns for `type: codebase` sources. Each entry is a glob
   * applied AFTER the include glob in `path`. Ignored for other types.
   */
  exclude?: string[];
  /**
   * Maximum total concatenated content size in bytes for `type: codebase`
   * sources. Defaults to 262144 (256 KB). Loading emits a warning to
   * `onProgress` if exceeded; hard cap at 4194304 (4 MB) always throws.
   * Ignored for other types.
   */
  maxBytes?: number;
  audit?: {
    /**
     * Controls the audit's trap cross-reference rule for this source:
     * - `true` (default when omitted): scan with every declared trap.
     * - `false`: scan with no traps. Use for deliberately stale fixtures.
     * - `string[]`: scan with every declared trap EXCEPT those listed by
     *   id. Use for policy docs that intentionally cite specific banned
     *   phrases as examples; future traps still apply.
     * Other audit rules (broken refs, line budgets, etc.) are unaffected
     * by this field. The list form requires every trap id across all
     * scenarios to be globally unique; the loader enforces this.
     */
    traps?: boolean | string[];
  };
}

export interface DocsConfig {
  /**
   * Named sources, keyed by ID. Value is either a file path / URL (string
   * form) or a `DocSourceEntry` object with optional audit metadata.
   */
  sources: Record<string, string | DocSourceEntry>;
}

/** Canonical normalized form of a docs.sources entry. */
export interface NormalizedDocSource {
  path: string;
  /**
   * Resolved audit-traps directive for this source:
   * - `true`: scan with every declared trap.
   * - `false`: skip all traps for this source.
   * - `string[]`: scan with every declared trap except those listed by id.
   */
  auditTraps: boolean | string[];
}

/** Normalize a string or object docs.sources entry to the canonical form. */
export function normalizeDocSource(
  value: string | DocSourceEntry,
): NormalizedDocSource {
  if (typeof value === "string") {
    return { path: value, auditTraps: true };
  }
  return { path: value.path, auditTraps: value.audit?.traps ?? true };
}

/** A loaded source with its registry ID, original location, and audit metadata. */
export interface ResolvedDocSource extends DocSource {
  id: string;
  source: string;
  /**
   * Audit trap cross-reference directive carried from the config. See
   * NormalizedDocSource.auditTraps for the three-way union semantics.
   */
  auditTraps: boolean | string[];
  /**
   * For `type: codebase` sources, the relative paths of every file the
   * glob expanded to. Used by the audit's trap cross-reference rule for
   * per-file finding attribution. Absent for file and URL sources.
   */
  matchedFiles?: string[];
}

// Matrix configuration for running scenarios across multiple targets/contexts
export interface MatrixConfig {
  target?: string[];
  context?: string[];
}

export interface CheckConfig {
  tool: {
    name: string;
    description: string;
  };

  // Named targets (reusable LLM interface definitions)
  targets?: Record<string, Target>;

  // Named contexts (reusable capability configurations) - future
  contexts?: Record<string, Context>;

  // Matrix for running all scenarios across multiple targets/contexts - future
  matrix?: MatrixConfig;

  /**
   * Named toolset profiles for the matrix evaluation `toolset` axis.
   * `none` is reserved as the deterministic baseline (no tools); the `web`
   * shape (`webSearch`/`webFetch` flags) runs on Claude Code, the
   * Anthropic API target, and the OpenAI API target today. Other profiles
   * (MCP servers, third-party crawlers) are recognized by the loader;
   * their tool adapters land per release.
   */
  toolsets?: Record<string, ToolsetConfig>;

  // Scenarios to run
  scenarios: Scenario[];

  // Documentation source (optional)
  docs?: DocsConfig;

  // Global threshold
  threshold?: number;
}
