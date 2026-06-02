import type {
  McpServerConfig,
  ResolvedDocSource,
  TargetCategory,
} from "@pickled-dev/config";

export { DEFAULT_TARGET } from "@pickled-dev/config";

export interface ResponseEntry {
  type: "initial" | "intermediate" | "final";
  text: string;
}

export interface TargetResult {
  /** The final response (what the user sees as the answer) */
  response: string;
  /** All responses captured during execution, for detailed reporting */
  allResponses: ResponseEntry[];
  toolsUsed: string[];
  sources: string[];
  metadata: {
    model: string;
    category: TargetCategory;
    provider: string;
    target: string;
  };
}

export interface RunOptions {
  tool: import("../types.js").ToolInfo;
  cwd: string;
  context?: ResolvedContext;
  /** Documentation sources to inject into the target prompt. Empty for
   *  discovery cells. */
  docs: ResolvedDocSource[];
  /** Source IDs the scenario requires the answer to cite. Empty for
   *  discovery cells (no citation contract). */
  requiredSources: string[];
  /**
   * Discovery-mode hint. Set by the matrix runner for cells with a non-none
   * toolset. When present, the adapter uses the discovery system prompt
   * instead of the citation prompt: source content is not injected; the
   * agent uses its tools to research, with `sourceHint` named as the
   * canonical reference (URL or human-readable name). When undefined,
   * normal citation mode applies.
   */
  discovery?: { sourceHint: string | null };
  /**
   * Restrict the SDK's built-in tool set for this run. The Claude Agent
   * SDK's `tools` option ([] disables all built-ins; a string array
   * scopes to those built-ins; preset uses defaults). Matrix runner sets
   * this for non-none cells so the agent cannot fall back to Read/Bash
   * and bypass the configured tool path the cell is meant to test.
   * Adapters that ignore this field (Codex, Anthropic API) treat all
   * non-none toolsets as unsupported elsewhere.
   */
  restrictBuiltinTools?: string[];
  /**
   * Provider-agnostic web-tool intent. Matrix runner sets this for web
   * cells on providers that do not consume `restrictBuiltinTools` (e.g.
   * the Anthropic API target, which maps `search: true` to the server-
   * side `web_search` tool entry on `messages.create`). Adapters that
   * scope tools via SDK built-ins (Claude Code) ignore this field and
   * read `restrictBuiltinTools` instead.
   */
  webTools?: { search?: boolean };
  /**
   * Provider-agnostic MCP-server intent. Matrix runner sets this for
   * `mcp` cells on the OpenAI Responses target (the OpenAI adapter
   * translates each entry to a hosted-MCP tool entry on
   * `responses.create`). The Claude Code adapter reads `mcpServers`
   * from its target config directly via the Agent SDK and ignores this
   * field. Each server's key in the map is used as the OpenAI
   * `server_label`, so the matrix runner's `mcp__<server>__*`
   * provenance matcher works across providers.
   */
  mcpTools?: { servers: Record<string, McpServerConfig> };
  /**
   * Build mode: run the agent as an editor of the workspace. The CLI adapters
   * switch to their edit profile (claude-code: workspace toolset +
   * permissionMode "bypassPermissions"; codex: --sandbox workspace-write).
   * Internal only - the build runner sets it for `kind: build` cells; it is
   * never exposed in the public schema. API adapters ignore it (no repo-edit
   * loop), and the runner gates build tasks to edit-capable agents first.
   */
  editMode?: boolean;
  /**
   * Build-task context for the system prompt (kind: build). When set, the CLI
   * adapter uses the build prompt (no citation contract, no `## Sources`
   * block) instead of the citation/discovery prompt: `docs` are injected for
   * `tools: none` cells, `sourceHint` names the discovery target otherwise.
   * Paired with `editMode`. Internal only.
   */
  buildContext?: { docs: ResolvedDocSource[]; sourceHint: string | null };
  onProgress?: (msg: string) => void;
}

export interface ResolvedContext {
  allowedTools?: string[];
  disallowedTools?: string[];
  mcpServers?: Record<string, unknown>;
}

export interface TargetRunner {
  readonly category: TargetCategory;
  readonly provider: string;
  readonly name: string;

  run(prompt: string, options: RunOptions): Promise<TargetResult>;
}
