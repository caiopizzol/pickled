import type {
  CheckConfig,
  ResolvedDocSource,
  Target,
} from "@pickled-dev/config";
import { resolveTarget } from "./targets/index.js";
import type { ResolvedContext, RunOptions } from "./targets/types.js";

export interface CellRuntime {
  baseTargetConfig: Target;
  targetConfig: Target;
  /** Context passed to the adapter; only `tools: none` cells get one. */
  cellContext: ResolvedContext | undefined;
  /** Docs injected into the prompt (empty for no-context / discovery cells). */
  cellDocs: ResolvedDocSource[];
  /** Source ids visible in this cell (the citation registry). */
  surfaceIds: string[];
  /** Required source ids that apply to this cell (citation contract). */
  requiredInCell: string[];
  discoveryHint: { sourceHint: string | null } | undefined;
  /** Derived from RunOptions so the two cannot drift. */
  runOptions: Pick<
    RunOptions,
    "restrictBuiltinTools" | "webTools" | "mcpTools"
  >;
  provenance: {
    /**
     * Semantic tool labels the cell expects (`web_search` for server-side web,
     * `WebSearch`/`WebFetch` for Claude web, `mcp__<server>__*` for MCP). Used
     * in the veto diagnostic. Distinct from the SDK auto-permit list, which is
     * empty for server-side web targets.
     */
    expectedLabels: string[];
    /** Whether any provenance matcher is configured (the veto gate). */
    hasMatchers: boolean;
    match: (toolName: string) => boolean;
  };
  isInjecting: boolean;
  isNoContext: boolean;
  wantsWeb: boolean;
  wantsMcp: boolean;
}

/**
 * Prepare the per-cell runtime shared by the answer and build runners: the
 * effective target config, source-injection decision, discovery hint, run
 * options (tool scoping / web / mcp intents), and the provenance matcher.
 *
 * Prepares only. It does not run the target and does not score - citation,
 * expected checks, and the provenance veto stay in each runner. The provider-
 * gate validation throws here intentionally, so callers invoke it OUTSIDE
 * their per-cell try and a misconfiguration bubbles to the scenario error
 * rather than collapsing into a single NO cell.
 */
export function resolveCellRuntime(args: {
  interfaceName: string;
  sourceName: string | null;
  toolsetName: string;
  config: CheckConfig;
  docs: ResolvedDocSource[];
  requiredSources: string[];
  contextConfig: ResolvedContext;
}): CellRuntime {
  const {
    interfaceName,
    sourceName,
    toolsetName,
    config,
    docs,
    requiredSources,
    contextConfig,
  } = args;

  const toolsetConfig =
    toolsetName === "none" ? null : (config.toolsets?.[toolsetName] ?? null);
  const wantsWeb =
    toolsetName !== "none" &&
    (toolsetConfig?.webSearch === true || toolsetConfig?.webFetch === true);
  const mcpServerNames =
    toolsetName !== "none" && toolsetConfig?.mcpServers
      ? Object.keys(toolsetConfig.mcpServers)
      : [];
  const wantsMcp = mcpServerNames.length > 0;

  const { config: baseTargetConfig } = resolveTarget(
    interfaceName,
    config.targets,
  );

  if (toolsetName !== "none") {
    if (wantsWeb && wantsMcp) {
      throw new Error(
        `Toolset "${toolsetName}" mixes webSearch/webFetch with mcpServers; declare separate toolsets per shape so provenance can be attributed to one tool path.`,
      );
    }
    if (!wantsWeb && !wantsMcp) {
      throw new Error(
        `Toolset "${toolsetName}" is declared but defines no runtime shape. Supported today: "none", web (webSearch/webFetch flags), MCP (mcpServers map). Other adapters (Firecrawl, native API search) land per release.`,
      );
    }
    if (
      wantsMcp &&
      baseTargetConfig.provider !== "claude-code" &&
      baseTargetConfig.provider !== "openai"
    ) {
      throw new Error(
        `Toolset "${toolsetName}" (MCP) is implemented on claude-code and openai interfaces today. Interface "${interfaceName}" uses provider "${baseTargetConfig.provider}"; rerun with a supported interface or use toolset "none".`,
      );
    }
    if (
      wantsWeb &&
      baseTargetConfig.provider !== "claude-code" &&
      baseTargetConfig.provider !== "anthropic" &&
      baseTargetConfig.provider !== "openai"
    ) {
      throw new Error(
        `Toolset "${toolsetName}" (web) is implemented on claude-code, anthropic, and openai interfaces today. Interface "${interfaceName}" uses provider "${baseTargetConfig.provider}"; rerun with a supported interface or use toolset "none".`,
      );
    }
    if (
      wantsWeb &&
      (baseTargetConfig.provider === "anthropic" ||
        baseTargetConfig.provider === "openai") &&
      !toolsetConfig?.webSearch
    ) {
      throw new Error(
        `Toolset "${toolsetName}" on ${baseTargetConfig.provider} provider requires webSearch: true. The ${baseTargetConfig.provider} API exposes a single server-side web tool; declare webSearch to enable it, or split web/fetch behaviour across separate toolsets.`,
      );
    }
  }

  // allowedForCell: SDK auto-permit list (Claude-only; empty for server-side
  // web). expectedLabels: semantic provenance labels (the veto diagnostic).
  // builtinToolsForCell: SDK built-in availability restriction (Claude-only).
  const allowedForCell: string[] = [];
  const builtinToolsForCell: string[] = [];
  const expectedLabels: string[] = [];
  const toolMatchers: Array<(t: string) => boolean> = [];
  const isServerWebTarget =
    baseTargetConfig.provider === "anthropic" ||
    baseTargetConfig.provider === "openai";
  if (wantsWeb) {
    if (isServerWebTarget) {
      expectedLabels.push("web_search");
      toolMatchers.push((t) => t === "web_search");
    } else {
      if (toolsetConfig?.webSearch) {
        allowedForCell.push("WebSearch");
        builtinToolsForCell.push("WebSearch");
        expectedLabels.push("WebSearch");
        toolMatchers.push((t) => t === "WebSearch");
      }
      if (toolsetConfig?.webFetch) {
        allowedForCell.push("WebFetch");
        builtinToolsForCell.push("WebFetch");
        expectedLabels.push("WebFetch");
        toolMatchers.push((t) => t === "WebFetch");
      }
    }
  }
  if (wantsMcp) {
    for (const s of mcpServerNames) {
      allowedForCell.push(`mcp__${s}__*`);
      expectedLabels.push(`mcp__${s}__*`);
      toolMatchers.push((t) => t.startsWith(`mcp__${s}__`));
    }
  }

  const targetConfig: Target =
    toolsetName === "none" || isServerWebTarget
      ? baseTargetConfig
      : {
          ...baseTargetConfig,
          allowedTools: allowedForCell,
          disallowedTools: [],
          mcpServers: wantsMcp ? toolsetConfig?.mcpServers : undefined,
          maxTurns: Math.max(baseTargetConfig.maxTurns ?? 0, 15),
        };

  const isInjecting = toolsetName === "none";
  const isNoContext = sourceName === "none";
  const cellDocs =
    isNoContext || !isInjecting
      ? []
      : sourceName === null
        ? docs
        : docs.filter((d) => d.id === sourceName);
  const surfaceIds =
    isNoContext || !isInjecting
      ? []
      : sourceName === null
        ? docs.map((d) => d.id)
        : [sourceName];
  const requiredInCell = isInjecting
    ? requiredSources.filter((id) => surfaceIds.includes(id))
    : [];

  const discoveryHint = isInjecting
    ? undefined
    : { sourceHint: buildDiscoveryHint(sourceName, docs) };

  return {
    baseTargetConfig,
    targetConfig,
    cellContext: toolsetName === "none" ? contextConfig : undefined,
    cellDocs,
    surfaceIds,
    requiredInCell,
    discoveryHint,
    runOptions: {
      restrictBuiltinTools:
        toolsetName === "none" ? undefined : builtinToolsForCell,
      webTools:
        wantsWeb && isServerWebTarget
          ? { search: toolsetConfig?.webSearch === true }
          : undefined,
      mcpTools:
        wantsMcp &&
        baseTargetConfig.provider === "openai" &&
        toolsetConfig?.mcpServers
          ? { servers: toolsetConfig.mcpServers }
          : undefined,
    },
    provenance: {
      expectedLabels,
      hasMatchers: toolMatchers.length > 0,
      match: (t: string) => toolMatchers.some((m) => m(t)),
    },
    isInjecting,
    isNoContext,
    wantsWeb,
    wantsMcp,
  };
}

/**
 * Discovery hint from the cell's active source: the URL for URL sources, the
 * human-readable name for file sources, or null when no source is declared.
 * Moved from check.ts; no other caller.
 */
function buildDiscoveryHint(
  sourceName: string | null,
  docs: ResolvedDocSource[],
): string | null {
  if (sourceName === null || sourceName === "none") return null;
  const source = docs.find((d) => d.id === sourceName);
  if (!source) return null;
  if (source.type === "url") return source.source;
  return source.name;
}
