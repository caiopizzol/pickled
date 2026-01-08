import type { Context, Target } from "@pickled-dev/config";
import { DEFAULT_TARGET } from "@pickled-dev/config";
import { ClaudeCodeTarget } from "./cli/claude-code.js";
import type { ResolvedContext, TargetRunner } from "./types.js";

export { DEFAULT_TARGET } from "@pickled-dev/config";
export type {
  ResolvedContext,
  RunOptions,
  TargetResult,
  TargetRunner,
} from "./types.js";

/**
 * Create a target runner from configuration
 */
export function createTarget(name: string, config?: Target): TargetRunner {
  const target = config ?? DEFAULT_TARGET;

  switch (target.category) {
    case "cli":
      return createCliTarget(name, target);
    case "api":
      throw new Error(`API targets not yet implemented. Coming soon!`);
    case "ide":
      throw new Error(`IDE targets not yet implemented. Coming soon!`);
    default:
      throw new Error(
        `Unknown target category: ${(target as Target).category}`,
      );
  }
}

/**
 * Create a CLI target runner
 */
function createCliTarget(name: string, config: Target): TargetRunner {
  switch (config.provider) {
    case "claude-code":
      return new ClaudeCodeTarget(name, config);
    case "gemini-cli":
      throw new Error(`Gemini CLI target not yet implemented. Coming soon!`);
    case "amazon-q":
      throw new Error(`Amazon Q target not yet implemented. Coming soon!`);
    default:
      throw new Error(`Unknown CLI provider: ${config.provider}`);
  }
}

/**
 * Resolve a target from config - handles named references and defaults
 */
export function resolveTarget(
  targetRef: string | undefined,
  targets: Record<string, Target> | undefined,
): { name: string; config: Target } {
  // No target specified - use default
  if (!targetRef) {
    return { name: "default", config: DEFAULT_TARGET };
  }

  // Look up named target
  if (targets?.[targetRef]) {
    return { name: targetRef, config: targets[targetRef] };
  }

  // Target not found - use default with warning
  console.warn(`Target "${targetRef}" not found, using default`);
  return { name: "default", config: DEFAULT_TARGET };
}

/**
 * Resolve a context from config - handles named references and defaults
 */
export function resolveContext(
  contextRef: string | undefined,
  contexts: Record<string, Context> | undefined,
): { name: string; config: ResolvedContext } {
  // No context specified - use empty (allows all default tools)
  if (!contextRef) {
    return { name: "default", config: {} };
  }

  // Look up named context
  if (contexts?.[contextRef]) {
    return { name: contextRef, config: contexts[contextRef] };
  }

  // Context not found - use empty with warning
  console.warn(`Context "${contextRef}" not found, using default`);
  return { name: "default", config: {} };
}
