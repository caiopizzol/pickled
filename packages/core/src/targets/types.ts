import type {
  McpServerConfig,
  ResolvedSource,
  TargetCategory,
} from "@pickled-dev/config";
import type { ToolInfo } from "../types.js";

export { DEFAULT_TARGET } from "@pickled-dev/config";

export interface ResponseEntry {
  type: "initial" | "intermediate" | "final";
  text: string;
}

export interface TargetResult {
  /** The final response (what the user sees as the answer). */
  response: string;
  /** All responses captured during execution, for detailed reporting. */
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

/**
 * Explicit prompt context: what the agent is asked and what material it gets.
 * The adapter switches on this to build its system prompt, so there is no
 * inference from loose flags and no fallback to a citation prompt.
 * - memory: answer from own knowledge (no injection, no tools).
 * - inject: source content placed in the prompt.
 * - web/mcp: research with tools; `sourceHint` names the canonical reference.
 * `build` uses the build prompt for the same three material shapes.
 */
export type PromptContext =
  | { kind: "question"; mode: "memory" }
  | { kind: "question"; mode: "inject"; docs: ResolvedSource[] }
  | { kind: "question"; mode: "web" | "mcp"; sourceHint: string | null }
  | { kind: "build"; mode: "memory" }
  | { kind: "build"; mode: "inject"; docs: ResolvedSource[] }
  | { kind: "build"; mode: "web" | "mcp"; sourceHint: string | null };

export interface RunOptions {
  tool: ToolInfo;
  cwd: string;
  promptContext: PromptContext;
  /**
   * Restrict the SDK's built-in tool set for this run (Claude Agent SDK
   * `tools`). The runner sets it for web/mcp cells so the agent cannot fall
   * back to Read/Bash and bypass the configured tool path. Adapters that scope
   * tools differently (Codex, API targets) ignore it.
   */
  restrictBuiltinTools?: string[];
  /**
   * Provider-agnostic web-tool intent for providers that do not consume
   * `restrictBuiltinTools` (the Anthropic/OpenAI API targets map `search: true`
   * to their server-side `web_search` tool). The Claude Code adapter ignores it.
   */
  webTools?: { search?: boolean };
  /**
   * Provider-agnostic hosted-MCP intent for the OpenAI Responses target (each
   * entry becomes a hosted-MCP tool on `responses.create`; the map key is the
   * `server_label`, so the `mcp__<server>__*` provenance matcher works across
   * providers). The Claude Code adapter reads `mcpServers` from its target
   * config via the Agent SDK and ignores this field.
   */
  mcpTools?: { servers: Record<string, McpServerConfig> };
  /**
   * Cancellation for the run. The build runner aborts this on a wall-clock
   * timeout; the CLI adapters wire it to a real teardown so a hung agent does
   * not orphan a process.
   */
  signal?: AbortSignal;
  onProgress?: (msg: string) => void;
}

export interface TargetRunner {
  readonly category: TargetCategory;
  readonly provider: string;
  readonly name: string;

  run(prompt: string, options: RunOptions): Promise<TargetResult>;
}
