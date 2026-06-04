import type {
  Config,
  Context,
  ResolvedSource,
  Target,
} from "@pickled-dev/config";
import type { PromptContext, RunOptions } from "./targets/types.js";

/** Providers whose adapters implement a web tool path. */
const WEB_PROVIDERS = new Set(["claude-code", "anthropic", "openai"]);
/** Providers whose adapters implement an MCP tool path. */
const MCP_PROVIDERS = new Set(["claude-code", "openai"]);

export interface CellRuntime {
  /** Resolved adapter config (tool scoping applied for web/mcp on claude-code). */
  target: Target;
  /** The explicit prompt context the adapter builds its system prompt from. */
  promptContext: PromptContext;
  /** Provider-agnostic tool intents the adapters consume. */
  runOptions: Pick<
    RunOptions,
    "restrictBuiltinTools" | "webTools" | "mcpTools"
  >;
  /**
   * Tool-use provenance: the labels a web/mcp cell expects and a matcher over
   * the agent's invoked tools. Empty (hasMatchers false) for memory/inject,
   * which have no tool path to prove.
   */
  provenance: {
    expectedLabels: string[];
    hasMatchers: boolean;
    match: (toolName: string) => boolean;
  };
  mode: Context["mode"];
  sourceId: string | null;
}

/**
 * Prepare the per-cell runtime shared by the question and build runners: the
 * effective target config, the prompt context (with injected source for inject
 * cells or a discovery hint for web/mcp), the tool intents, and the provenance
 * matcher. Provider gates throw here (outside any per-cell try) so a
 * misconfiguration surfaces as a clear error rather than collapsing into a
 * single NO cell. Codex (provider codex-cli) supports only memory/inject, so a
 * web/mcp cell on it is rejected here.
 */
export function resolveCellRuntime(args: {
  agent: string;
  context: Context;
  config: Config;
  sources: ResolvedSource[];
  kind: "question" | "build";
}): CellRuntime {
  const { agent, context, config, sources, kind } = args;
  const base = config.agents[agent];
  if (!base) throw new Error(`Unknown agent "${agent}".`);
  const provider = base.provider;
  const mode = context.mode;
  const sourceId = mode === "memory" ? null : (context.source ?? null);

  if (mode === "web" && !WEB_PROVIDERS.has(provider)) {
    throw new Error(
      `context mode "web" is not supported on provider "${provider}" (agent "${agent}"). Supported: claude-code, anthropic, openai. Use mode memory/inject, or a supported agent.`,
    );
  }
  if (mode === "mcp" && !MCP_PROVIDERS.has(provider)) {
    throw new Error(
      `context mode "mcp" is not supported on provider "${provider}" (agent "${agent}"). Supported: claude-code, openai. Use mode memory/inject, or a supported agent.`,
    );
  }

  let promptContext: PromptContext;
  if (mode === "memory") {
    promptContext = { kind, mode: "memory" };
  } else if (mode === "inject") {
    const doc = sources.find((s) => s.id === sourceId);
    promptContext = { kind, mode: "inject", docs: doc ? [doc] : [] };
  } else {
    promptContext = {
      kind,
      mode,
      sourceHint: buildSourceHint(sourceId, sources),
    };
  }

  const isServerWeb = provider === "anthropic" || provider === "openai";
  const expectedLabels: string[] = [];
  const matchers: Array<(t: string) => boolean> = [];
  let restrictBuiltinTools: string[] | undefined;
  let webTools: RunOptions["webTools"];
  let mcpTools: RunOptions["mcpTools"];
  let target: Target = base;

  if (mode === "web") {
    if (isServerWeb) {
      webTools = { search: true };
      expectedLabels.push("web_search");
      matchers.push((t) => t === "web_search");
    } else {
      restrictBuiltinTools = ["WebSearch", "WebFetch"];
      expectedLabels.push("WebSearch", "WebFetch");
      matchers.push((t) => t === "WebSearch" || t === "WebFetch");
      target = {
        ...base,
        allowedTools: ["WebSearch", "WebFetch"],
        disallowedTools: [],
        maxTurns: Math.max(base.maxTurns ?? 0, 15),
      };
    }
  } else if (mode === "mcp") {
    const servers = context.mode === "mcp" ? context.servers : {};
    const labels = Object.keys(servers);
    for (const s of labels) {
      expectedLabels.push(`mcp__${s}__*`);
      matchers.push((t) => t.startsWith(`mcp__${s}__`));
    }
    if (provider === "openai") {
      mcpTools = { servers };
    } else {
      restrictBuiltinTools = labels.map((s) => `mcp__${s}__*`);
      target = {
        ...base,
        allowedTools: labels.map((s) => `mcp__${s}__*`),
        disallowedTools: [],
        mcpServers: servers,
        maxTurns: Math.max(base.maxTurns ?? 0, 15),
      };
    }
  }

  return {
    target,
    promptContext,
    runOptions: { restrictBuiltinTools, webTools, mcpTools },
    provenance: {
      expectedLabels,
      hasMatchers: matchers.length > 0,
      match: (t: string) => matchers.some((m) => m(t)),
    },
    mode,
    sourceId,
  };
}

/** Discovery hint for a web/mcp cell: the URL for url sources, else the name. */
function buildSourceHint(
  sourceId: string | null,
  sources: ResolvedSource[],
): string | null {
  if (!sourceId) return null;
  const s = sources.find((x) => x.id === sourceId);
  if (!s) return null;
  return s.type === "url" ? s.source : s.name;
}
