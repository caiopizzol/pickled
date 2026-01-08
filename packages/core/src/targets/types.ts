import type { Target, TargetCategory, ToolInfo } from "../types.js";

/**
 * Result from running a scenario against a target
 */
export interface TargetResult {
  response: string;
  toolsUsed: string[];
  sources: string[]; // URLs visited, files read, etc.
  metadata: {
    model: string;
    category: TargetCategory;
    provider: string;
    target: string; // Name of the target used
  };
}

/**
 * Options for running a scenario
 */
export interface RunOptions {
  tool: ToolInfo;
  cwd: string;
  context?: ResolvedContext;
  onProgress?: (msg: string) => void;
}

/**
 * Resolved context with merged settings
 */
export interface ResolvedContext {
  allowedTools?: string[];
  disallowedTools?: string[];
  mcpServers?: Record<string, unknown>;
}

/**
 * Abstract interface for target runners
 */
export interface TargetRunner {
  readonly category: TargetCategory;
  readonly provider: string;
  readonly name: string;

  /**
   * Run a prompt against this target
   */
  run(prompt: string, options: RunOptions): Promise<TargetResult>;
}

/**
 * Configuration for creating a target
 */
export interface TargetConfig extends Target {
  // All fields from Target, plus any target-specific overrides
}

/**
 * Default target configuration
 */
export const DEFAULT_TARGET: Target = {
  category: "cli",
  provider: "claude-code",
  model: "claude-sonnet-4-20250514",
};
