import type { Target } from "./types.js";

/**
 * Default target configuration for pickled checks.
 * Uses Claude Code with Sonnet model via the Agent SDK.
 */
export const DEFAULT_TARGET: Target = {
  category: "cli",
  provider: "claude-code",
  model: "sonnet", // Model alias - see https://code.claude.com/docs/en/model-config
};

export const DEFAULT_ALLOWED_TOOLS = ["Read", "Glob", "Grep", "Bash"];

export const DEFAULT_DISALLOWED_TOOLS = [
  "Edit",
  "MultiEdit",
  "Write",
  "NotebookEdit",
];
