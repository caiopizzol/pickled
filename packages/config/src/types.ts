// Target categories for different LLM interaction modes
export type TargetCategory = "api" | "cli" | "ide";

// Providers by category
export type ApiProvider = "anthropic" | "openai" | "google";
export type CliProvider =
  | "claude-code"
  | "codex-cli"
  | "gemini-cli"
  | "amazon-q";
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
}

// Scenario - a test case
export interface Scenario {
  name: string;
  prompt: string;
  target?: string; // Reference to named target
  context?: string; // Reference to named context

  /**
   * Source IDs (from docs.sources) the answer must cite. Use [] to allow
   * any registered source as a valid citation without requiring a specific one.
   */
  requiredSources: string[];

  /**
   * Optional traps. Each is a deterministic stale-answer detector; firing
   * any trap forces the scenario to NO with confidence 0.
   */
  traps?: Trap[];
}

export type DocSourceType = "url" | "file" | "mcp" | "codebase";

export interface DocSource {
  content: string;
  name: string;
  type: DocSourceType;
}

export interface DocsConfig {
  /** Named sources, keyed by ID, value is file path or URL. */
  sources: Record<string, string>;
}

/** A loaded source with its registry ID and original location. */
export interface ResolvedDocSource extends DocSource {
  id: string;
  source: string;
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

  // Scenarios to run
  scenarios: Scenario[];

  // Documentation source (optional)
  docs?: DocsConfig;

  // Global threshold
  threshold?: number;
}
