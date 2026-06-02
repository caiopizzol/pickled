import type { TargetCategory } from "@pickled-dev/config";

/** Providers that can edit a workspace in build mode (CLI coding agents). */
const EDIT_CAPABLE_PROVIDERS = new Set(["claude-code", "codex-cli"]);

/**
 * Whether a target can run `kind: build` tasks - edit files and run commands
 * in a workspace. Only the CLI coding agents qualify today; API providers
 * (anthropic/openai) have no repo-edit loop, so they are answer-only.
 */
export function isEditCapable(target: {
  category: TargetCategory;
  provider: string;
}): boolean {
  return (
    target.category === "cli" && EDIT_CAPABLE_PROVIDERS.has(target.provider)
  );
}

/**
 * Gate a build task to an edit-capable agent. Throws with the agent name and
 * the supported providers so the failure is actionable. The build runner calls
 * this before invoking any agent for a `kind: build` cell.
 */
export function assertEditCapable(
  name: string,
  target: { category: TargetCategory; provider: string },
): void {
  if (!isEditCapable(target)) {
    throw new Error(
      `agent "${name}" (${target.category}/${target.provider}) cannot run build tasks. Build requires an edit-capable CLI agent: claude-code or codex-cli.`,
    );
  }
}
