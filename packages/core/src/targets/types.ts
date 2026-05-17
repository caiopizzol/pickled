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
  /** Documentation sources to inject into the target prompt. */
  docs: ResolvedDocSource[];
  /** Source IDs the scenario requires the answer to cite. */
  requiredSources: string[];
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
