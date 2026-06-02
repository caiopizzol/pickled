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

/**
 * Workspace edit profile for build mode. Adds the structured edit tools to the
 * read/inspect set so an edit-capable agent can modify a throwaway workspace.
 * Internal only; selected by the runner for `kind: build`, never authored in
 * the public schema. Paired with permissionMode "bypassPermissions" inside the
 * temp workspace (the containment boundary).
 */
export const EDIT_ALLOWED_TOOLS = [
  "Read",
  "Glob",
  "Grep",
  "Bash",
  "Edit",
  "MultiEdit",
  "Write",
];
