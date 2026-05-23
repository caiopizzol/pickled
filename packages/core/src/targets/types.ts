import type { ResolvedDocSource, TargetCategory } from "@pickled-dev/config";

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
