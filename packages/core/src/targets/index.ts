import type { Context, Target } from "@pickled-dev/config";
import { DEFAULT_TARGET } from "@pickled-dev/config";
import { AnthropicApiTarget } from "./api/anthropic.js";
import { OpenAIApiTarget } from "./api/openai.js";
import { ClaudeCodeTarget } from "./cli/claude-code.js";
import { CodexCliTarget } from "./cli/codex.js";
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
      return createApiTarget(name, target);
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
    case "codex-cli":
      return new CodexCliTarget(name, config);
    case "gemini-cli":
      throw new Error(`Gemini CLI target not yet implemented. Coming soon!`);
    case "amazon-q":
      throw new Error(`Amazon Q target not yet implemented. Coming soon!`);
    default:
      throw new Error(`Unknown CLI provider: ${config.provider}`);
  }
}

/**
 * Create an API target runner
 */
function createApiTarget(name: string, config: Target): TargetRunner {
  switch (config.provider) {
    case "anthropic":
      return new AnthropicApiTarget(name, config);
    case "openai":
      return new OpenAIApiTarget(name, config);
    case "google":
      throw new Error(`Google API target not yet implemented. Coming soon!`);
    default:
      throw new Error(`Unknown API provider: ${config.provider}`);
  }
}

const DEFAULT_SENTINEL = "default";

export function resolveTarget(
  targetRef: string | undefined,
  targets: Record<string, Target> | undefined,
): { name: string; config: Target } {
  if (!targetRef || targetRef === DEFAULT_SENTINEL) {
    return { name: DEFAULT_SENTINEL, config: DEFAULT_TARGET };
  }
  if (targets?.[targetRef]) {
    return { name: targetRef, config: targets[targetRef] };
  }
  console.warn(`Target "${targetRef}" not found, using default`);
  return { name: DEFAULT_SENTINEL, config: DEFAULT_TARGET };
}

export function resolveContext(
  contextRef: string | undefined,
  contexts: Record<string, Context> | undefined,
): { name: string; config: ResolvedContext } {
  if (!contextRef || contextRef === DEFAULT_SENTINEL) {
    return { name: DEFAULT_SENTINEL, config: {} };
  }
  if (contexts?.[contextRef]) {
    return { name: contextRef, config: contexts[contextRef] };
  }
  console.warn(`Context "${contextRef}" not found, using default`);
  return { name: DEFAULT_SENTINEL, config: {} };
}
