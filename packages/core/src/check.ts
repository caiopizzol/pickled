import type {
  CheckConfig,
  ResolvedDocSource,
  Scenario,
} from "@pickled-dev/config";
import { getScenarioStatus } from "./report-status.js";
import {
  type Answerable,
  scoreCitations,
  scoreExpected,
  scoreTraps,
} from "./scorers/index.js";
import { fetchAllSources } from "./sources.js";
import {
  createTarget,
  DEFAULT_TARGET,
  resolveContext,
  resolveTarget,
  type TargetRunner,
} from "./targets/index.js";
import type {
  CellResult,
  CheckReport,
  ScenarioResult,
  SurfaceResult,
  ToolInfo,
} from "./types.js";

const MATRIX_SENTINEL = "__matrix__";

interface ExpandedScenario {
  scenario: Scenario;
  targetName: string;
  contextName: string;
}

function expandMatrix(config: CheckConfig): ExpandedScenario[] {
  const expanded: ExpandedScenario[] = [];
  const matrixTargets = config.matrix?.target ?? ["default"];
  const matrixContexts = config.matrix?.context ?? ["default"];

  for (const scenario of config.scenarios) {
    const contexts = scenario.context ? [scenario.context] : matrixContexts;
    if (scenario.matrix) {
      // Matrix-mode scenarios own their interface axis; emit once per context
      // with a sentinel target name. The matrix branch in runScenario iterates
      // over matrix.interfaces internally and creates per-cell targets.
      for (const contextName of contexts) {
        expanded.push({
          scenario,
          targetName: MATRIX_SENTINEL,
          contextName,
        });
      }
      continue;
    }
    const targets = scenario.target ? [scenario.target] : matrixTargets;
    for (const targetName of targets) {
      for (const contextName of contexts) {
        expanded.push({ scenario, targetName, contextName });
      }
    }
  }
  return expanded;
}

export interface CheckOptions {
  onProgress?: (msg: string) => void;
  /** Optional override of the target factory, mainly for tests. */
  targetFactory?: (
    name: string,
    target: Parameters<typeof createTarget>[1],
  ) => TargetRunner;
  /**
   * Matrix-mode cell filters. When set, only cells matching the filter run;
   * other cells are skipped. Designed to support GitHub Actions matrix usage
   * where each CI job runs one cell (e.g.,
   * `pickled check --interface codex --source readme --toolset none`).
   * Each filter accepts a single name; omit to include all cells on that axis.
   */
  cellFilter?: {
    interface?: string;
    source?: string;
    toolset?: string;
  };
  /** Restrict to scenarios with these names. Empty/omitted = all scenarios. */
  scenarioFilter?: string[];
}

export async function runCheck(
  tool: ToolInfo,
  config: CheckConfig,
  options: CheckOptions = {},
): Promise<CheckReport> {
  const { onProgress } = options;
  const results: ScenarioResult[] = [];

  if (config.scenarios.length === 0) {
    throw new Error("No scenarios defined in config");
  }

  const sourcesMap = config.docs?.sources ?? {};
  let docs: ResolvedDocSource[] = [];
  if (Object.keys(sourcesMap).length > 0) {
    onProgress?.("Loading sources...");
    docs = await fetchAllSources(sourcesMap, tool.path);
    for (const d of docs) {
      onProgress?.(`  [${d.id}] ${d.name}`);
    }
    onProgress?.("");
  }

  const registeredIds = docs.map((d) => d.id);
  let expanded = expandMatrix(config);

  // Apply scenario name filter (used by CLI --scenario flag and CI matrix
  // jobs that run one scenario at a time).
  if (options.scenarioFilter && options.scenarioFilter.length > 0) {
    const wanted = new Set(options.scenarioFilter);
    expanded = expanded.filter((e) => wanted.has(e.scenario.name));
    if (expanded.length === 0) {
      throw new Error(
        `No scenarios matched filter: ${[...wanted].join(", ")}. Declared scenarios: ${config.scenarios.map((s) => s.name).join(", ")}`,
      );
    }
  }
  let currentScenario = "";

  for (const { scenario, targetName, contextName } of expanded) {
    const label = formatRunLabel(targetName, contextName);

    if (scenario.name !== currentScenario) {
      if (currentScenario) onProgress?.("");
      onProgress?.(`"${scenario.name}"`);
      currentScenario = scenario.name;
    }

    try {
      const result = await runScenario(
        scenario,
        targetName,
        contextName,
        tool,
        config,
        docs,
        registeredIds,
        options,
      );
      results.push(result);

      const labelPadded = label ? label.padEnd(18) : "";
      if (result.cells) {
        onProgress?.(`  ${labelPadded} (matrix mode)`);
        for (const cell of result.cells) {
          const status = getScenarioStatus(cell);
          const labelParts = [
            cell.cell.interface,
            cell.cell.source ?? "-",
            cell.cell.toolset,
          ];
          const cellLabel = `    [${labelParts.join(" · ")}]`.padEnd(40);
          onProgress?.(
            `${cellLabel} ${status.icon} ${status.label} (${status.confidence}%)`,
          );
        }
      } else if (result.surfaces) {
        onProgress?.(`  ${labelPadded} (compare-surfaces mode)`);
        for (const surface of result.surfaces) {
          const status = getScenarioStatus(surface);
          const surfaceLabel = `    [${surface.active.join(",")}]`.padEnd(22);
          onProgress?.(
            `${surfaceLabel} ${status.icon} ${status.label} (${status.confidence}%)`,
          );
        }
      } else {
        // Single-mode result: top-level fields are populated.
        const status = getScenarioStatus({
          answerable: result.answerable ?? "NO",
          confidence: result.confidence ?? 0,
          traps: result.traps ?? { fired: [], avoided: [] },
          error: result.error,
        });
        onProgress?.(
          `  ${labelPadded} ${status.icon} ${status.label} (${status.confidence}%)`,
        );
      }
    } catch (error) {
      const targetConfig =
        targetName === "default"
          ? DEFAULT_TARGET
          : (config.targets?.[targetName] ?? DEFAULT_TARGET);
      const required = scenario.requiredSources ?? [];
      const errorResult: ScenarioResult = {
        scenario,
        answerable: "NO",
        confidence: 0,
        response: "",
        reason: "Error during run",
        citations: {
          cited: [],
          required,
          missing: required,
          unknown: [],
        },
        traps: {
          fired: [],
          avoided: (scenario.traps ?? []).map((t) => t.id),
        },
        error: error instanceof Error ? error.message : String(error),
        target: {
          target: targetName === MATRIX_SENTINEL ? "matrix" : targetName,
          category: targetConfig.category,
          provider: targetConfig.provider,
          model: targetConfig.model ?? "unknown",
        },
        context: { name: contextName },
      };
      results.push(errorResult);
      const labelPadded = label ? label.padEnd(18) : "";
      onProgress?.(`  ${labelPadded} ✗ Error`);
    }
  }

  onProgress?.("");
  return buildReport(tool, docs, results);
}

function formatRunLabel(targetName: string, contextName: string): string {
  if (targetName === "default" && contextName === "default") return "";
  if (contextName === "default") return `[${targetName}]`;
  return `[${targetName}/${contextName}]`;
}

async function runScenario(
  scenario: Scenario,
  targetName: string,
  contextName: string,
  tool: ToolInfo,
  config: CheckConfig,
  docs: ResolvedDocSource[],
  registeredIds: string[],
  options: CheckOptions,
): Promise<ScenarioResult> {
  // Matrix mode owns its interface axis; runScenario was called via the
  // sentinel from expandMatrix. Dispatch to the matrix branch and skip the
  // single-target/compareSurfaces paths.
  if (scenario.matrix && targetName === MATRIX_SENTINEL) {
    return runMatrixScenario(
      scenario,
      contextName,
      tool,
      config,
      docs,
      options,
    );
  }

  const { config: targetConfig } = resolveTarget(targetName, config.targets);
  const { config: contextConfig } = resolveContext(
    contextName,
    config.contexts,
  );

  const target = options.targetFactory
    ? options.targetFactory(targetName, targetConfig)
    : createTarget(targetName, targetConfig);

  // Compare-surfaces mode: run the scenario once per declared surface, each
  // with only that surface's sources visible. Top-level evaluation fields
  // stay null per proposals/compare-surfaces.md Decision 3.
  if (scenario.compareSurfaces && scenario.compareSurfaces.length > 0) {
    const surfaces: SurfaceResult[] = [];
    let metadata: ScenarioResult["target"];
    for (const surface of scenario.compareSurfaces) {
      const surfaceIds = new Set(surface);
      const surfaceDocs = docs.filter((d) => surfaceIds.has(d.id));
      // Intersection citation contract: required ∩ surface. Empty intersection
      // softens to "any cited source in the active surface counts."
      const required = scenario.requiredSources ?? [];
      const requiredInSurface = required.filter((id) => surfaceIds.has(id));

      const runResult = await target.run(scenario.prompt, {
        tool,
        cwd: tool.path,
        context: contextConfig,
        docs: surfaceDocs,
        requiredSources: requiredInSurface,
        onProgress: options.onProgress,
      });

      const citationScore = scoreCitations({
        response: runResult.response,
        requiredSources: requiredInSurface,
        registeredIds: surface,
      });

      const trapDetails = scoreTraps({
        response: runResult.response,
        traps: scenario.traps ?? [],
      });

      const trapFired = trapDetails.fired.length > 0;
      const answerable = trapFired ? "NO" : citationScore.answerable;
      const confidence = trapFired ? 0 : citationScore.confidence;
      const reason = trapFired
        ? `Trap fired: ${trapDetails.fired.map((t) => `"${t.id}" (${t.reason})`).join("; ")}`
        : citationScore.reason;

      surfaces.push({
        active: surface,
        answerable,
        confidence,
        response: runResult.response,
        reason,
        citations: citationScore.citations,
        traps: trapDetails,
        allResponses: runResult.allResponses,
      });

      metadata = runResult.metadata ?? metadata;
    }

    return {
      scenario,
      answerable: null,
      confidence: null,
      response: null,
      reason: null,
      citations: null,
      traps: null,
      surfaces,
      target: metadata,
      context: { name: contextName },
    };
  }

  const required = scenario.requiredSources ?? [];
  const result = await target.run(scenario.prompt, {
    tool,
    cwd: tool.path,
    context: contextConfig,
    docs,
    requiredSources: required,
    onProgress: options.onProgress,
  });

  // Score: trap (universal veto) > citation (if requiredSources declared)
  // + expected (if expected declared). Composition matches matrix mode so
  // single-mode and matrix-mode treat the same contract the same way.
  const trapDetails = scoreTraps({
    response: result.response,
    traps: scenario.traps ?? [],
  });
  const trapFired = trapDetails.fired.length > 0;

  const citationScore =
    scenario.requiredSources !== undefined
      ? scoreCitations({
          response: result.response,
          requiredSources: required,
          registeredIds,
        })
      : null;

  const expectedDetail =
    scenario.expected !== undefined
      ? scoreExpected({
          response: result.response,
          expected: scenario.expected,
        })
      : null;

  let answerable: Answerable;
  let confidence: number;
  let reason: string;

  if (trapFired) {
    answerable = "NO";
    confidence = 0;
    reason = `Trap fired: ${trapDetails.fired.map((t) => `"${t.id}" (${t.reason})`).join("; ")}`;
  } else {
    const parts: Array<{ answerable: Answerable; confidence: number }> = [];
    const reasons: string[] = [];
    if (citationScore) {
      parts.push({
        answerable: citationScore.answerable,
        confidence: citationScore.confidence,
      });
      reasons.push(citationScore.reason);
    }
    if (expectedDetail) {
      const pct =
        expectedDetail.total === 0
          ? 100
          : Math.round((expectedDetail.satisfied / expectedDetail.total) * 100);
      const expectedAnswerable: Answerable =
        pct === 100 ? "YES" : pct === 0 ? "NO" : "PARTIAL";
      parts.push({ answerable: expectedAnswerable, confidence: pct });
    }
    if (parts.length === 0) {
      // Validator should reject this; if it slips through, treat as YES.
      answerable = "YES";
      confidence = 100;
      reason = "No traps fired; no other contract declared";
    } else {
      const rank: Record<Answerable, number> = { YES: 0, PARTIAL: 1, NO: 2 };
      const worst = parts.reduce((acc, p) =>
        rank[p.answerable] > rank[acc.answerable] ? p : acc,
      );
      answerable = worst.answerable;
      confidence = Math.round(
        parts.reduce((sum, p) => sum + p.confidence, 0) / parts.length,
      );
      reason = reasons.filter((r) => r.length > 0).join(" | ");
    }
  }

  return {
    scenario,
    answerable,
    confidence,
    response: result.response,
    reason,
    citations: citationScore
      ? citationScore.citations
      : { cited: [], required, missing: [], unknown: [] },
    traps: trapDetails,
    target: result.metadata,
    context: { name: contextName },
    toolsUsed: result.toolsUsed,
    sources: result.sources,
    allResponses: result.allResponses,
  };
}

function buildReport(
  tool: ToolInfo,
  docs: ResolvedDocSource[],
  results: ScenarioResult[],
): CheckReport {
  // Each "evaluation" is one data point in the score average. Compare-mode
  // results contribute one evaluation per surface; single-mode results
  // contribute one. See proposals/compare-surfaces.md Decision 3.
  type Eval = {
    answerable: "YES" | "PARTIAL" | "NO";
    confidence: number;
  };
  const evals: Eval[] = [];
  for (const r of results) {
    if (r.surfaces) {
      for (const s of r.surfaces) {
        evals.push({ answerable: s.answerable, confidence: s.confidence });
      }
      continue;
    }
    if (r.cells) {
      for (const c of r.cells) {
        evals.push({ answerable: c.answerable, confidence: c.confidence });
      }
      continue;
    }
    if (r.answerable !== null && r.confidence !== null) {
      evals.push({ answerable: r.answerable, confidence: r.confidence });
    }
  }

  const total = evals.length;
  const answered = evals.filter(
    (e) => e.answerable === "YES" || e.answerable === "PARTIAL",
  ).length;

  const score =
    total > 0
      ? Math.round(
          evals.reduce((sum, e) => {
            if (e.answerable === "YES") return sum + e.confidence;
            if (e.answerable === "PARTIAL") return sum + e.confidence * 0.5;
            return sum;
          }, 0) / total,
        )
      : 0;

  return {
    tool: { name: tool.name, description: tool.description, path: tool.path },
    docs,
    scenarios: results,
    summary: {
      total,
      answered,
      unanswered: total - answered,
      score,
    },
  };
}

/**
 * Matrix-mode scenario runner. Expands the scenario's matrix declaration
 * into one cell per (interface × source × toolset), applies CLI cell
 * filters, and emits one CellResult per surviving cell.
 *
 * Runtime support today: `toolset = "none"` (deterministic baseline),
 * the `web` shape (`webSearch`/`webFetch` flags), and the `mcp` shape
 * (`mcpServers` map), both on Claude Code. Toolsets with no recognized
 * shape, mixed shapes (web flags + mcpServers), or non-claude-code
 * interfaces throw with a clear per-cell error so misconfigurations
 * are not masked by silent no-ops; further adapters land per release.
 */
async function runMatrixScenario(
  scenario: Scenario,
  contextName: string,
  tool: ToolInfo,
  config: CheckConfig,
  docs: ResolvedDocSource[],
  options: CheckOptions,
): Promise<ScenarioResult> {
  const { config: contextConfig } = resolveContext(
    contextName,
    config.contexts,
  );

  const matrix = scenario.matrix ?? {};
  const defaultInterface = scenario.target ?? "default";
  const interfaces = matrix.interfaces ?? [defaultInterface];
  const sourceAxis: Array<string | null> = matrix.sources ?? [null];
  const toolsets = matrix.toolsets ?? ["none"];

  const cellFilter = options.cellFilter ?? {};

  const cells: CellResult[] = [];
  let metadata: ScenarioResult["target"];

  for (const interfaceName of interfaces) {
    if (cellFilter.interface && cellFilter.interface !== interfaceName) {
      continue;
    }
    for (const sourceName of sourceAxis) {
      if (
        cellFilter.source !== undefined &&
        cellFilter.source !== (sourceName ?? "")
      ) {
        continue;
      }
      for (const toolsetName of toolsets) {
        if (cellFilter.toolset && cellFilter.toolset !== toolsetName) {
          continue;
        }
        // Toolset resolution. Three toolset shapes run today:
        // - "none": deterministic baseline. Source is injected. Citation
        //   contract applies if requiredSources is declared.
        // - web: `webSearch`/`webFetch` flags on Claude Code. Tools
        //   enabled, source NOT injected, citation contract skipped.
        // - mcp: `mcpServers` map on Claude Code. The configured MCP
        //   servers are passed through to the Agent SDK; allowedTools
        //   is overridden to `mcp__<server>__*` wildcards so default
        //   Read/Edit/Bash don't leak. Source NOT injected.
        // Mixed shapes (web+mcp in one toolset) are rejected because
        // pickled cannot attribute provenance honestly across both.
        const toolsetConfig =
          toolsetName === "none"
            ? null
            : (config.toolsets?.[toolsetName] ?? null);
        const wantsWeb =
          toolsetName !== "none" &&
          (toolsetConfig?.webSearch === true ||
            toolsetConfig?.webFetch === true);
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
          if (baseTargetConfig.provider !== "claude-code") {
            throw new Error(
              `Toolset "${toolsetName}" is implemented only on the claude-code interface. Interface "${interfaceName}" uses provider "${baseTargetConfig.provider}"; rerun with a Claude Code interface or use toolset "none".`,
            );
          }
        }

        // Build the effective per-cell target config. For non-none
        // toolsets, OVERRIDE allowedTools so the cell is a controlled
        // experiment (no Read/Edit/Write/Bash from defaults). Non-none
        // cells also need more turns because the agent typically does
        // discover -> fetch -> reason -> respond. Bump maxTurns to 15
        // unless the target already declares a higher value.
        //
        // Provenance match list (mirrors allowedForCell): the cell passes
        // provenance iff at least one configured tool was actually used.
        // Web: exact-name match (WebSearch/WebFetch). MCP: prefix match
        // on `mcp__<server>__` because individual MCP tool names come
        // from the server (e.g., `mcp__context7__resolve-library-id`).
        // Three lists for the cell:
        // - allowedForCell: the SDK's auto-permission list (passed as
        //   `allowedTools`). This bypasses permission prompts but does
        //   NOT restrict tool availability on its own.
        // - builtinToolsForCell: the SDK's built-in tool restriction
        //   (passed as `tools`). This is what actually scopes the cell
        //   to the intended path. Empty for MCP cells (built-ins
        //   disabled; MCP tools come from mcpServers).
        // - toolMatchers: provenance predicates over invoked tool names.
        const allowedForCell: string[] = [];
        const builtinToolsForCell: string[] = [];
        const toolMatchers: Array<(t: string) => boolean> = [];
        if (wantsWeb) {
          if (toolsetConfig?.webSearch) {
            allowedForCell.push("WebSearch");
            builtinToolsForCell.push("WebSearch");
            toolMatchers.push((t) => t === "WebSearch");
          }
          if (toolsetConfig?.webFetch) {
            allowedForCell.push("WebFetch");
            builtinToolsForCell.push("WebFetch");
            toolMatchers.push((t) => t === "WebFetch");
          }
        }
        if (wantsMcp) {
          for (const s of mcpServerNames) {
            allowedForCell.push(`mcp__${s}__*`);
            toolMatchers.push((t) => t.startsWith(`mcp__${s}__`));
          }
        }
        const targetConfig =
          toolsetName === "none"
            ? baseTargetConfig
            : {
                ...baseTargetConfig,
                allowedTools: allowedForCell,
                disallowedTools: [],
                mcpServers: wantsMcp ? toolsetConfig?.mcpServers : undefined,
                maxTurns: Math.max(baseTargetConfig.maxTurns ?? 0, 15),
              };

        const target = options.targetFactory
          ? options.targetFactory(interfaceName, targetConfig)
          : createTarget(interfaceName, targetConfig);

        // Source × Toolset semantics (matrix proposal Decision 6):
        // - Tools: none + source -> inject the source content.
        // - Tools: <web> + source -> do NOT inject; rewrite prompt to name
        //   the source as the discovery target. Agent reaches it via tools.
        // - Verifiers.sources are loaded but never injected.
        const isInjecting = toolsetName === "none";
        const cellDocs = isInjecting
          ? sourceName === null
            ? docs
            : docs.filter((d) => d.id === sourceName)
          : [];
        const surfaceIds = isInjecting
          ? sourceName === null
            ? docs.map((d) => d.id)
            : [sourceName]
          : [];
        const required = scenario.requiredSources ?? [];
        // Citation contract applies only in controlled mode (toolset: none).
        // Discovery mode cells rely on traps + expected.
        const requiredInCell = isInjecting
          ? required.filter((id) => surfaceIds.includes(id))
          : [];

        const effectivePrompt = buildCellPrompt(
          scenario.prompt,
          sourceName,
          docs,
          isInjecting,
        );

        // Discovery hint: for non-none cells with a named source, the URL
        // (for URL sources) or readable name reaches the adapter via the
        // RunOptions.discovery field so the adapter swaps in the discovery
        // system prompt. None-toolset cells leave this undefined.
        const discoveryHint = isInjecting
          ? undefined
          : { sourceHint: buildDiscoveryHint(sourceName, docs) };

        let runResult: Awaited<ReturnType<typeof target.run>>;
        try {
          // For non-none cells, the toolset declaration is the single
          // source of truth for the cell's available tools and MCP
          // servers. Passing a scenario/context-level override here
          // would let the adapter's `context?.X ?? this.config.X`
          // precedence path swap in a different tool set, breaking the
          // matrix contract that the cell label honestly describes
          // what the agent had available. None cells still get context.
          const cellContext =
            toolsetName === "none" ? contextConfig : undefined;
          runResult = await target.run(effectivePrompt, {
            tool,
            cwd: tool.path,
            context: cellContext,
            docs: cellDocs,
            requiredSources: requiredInCell,
            discovery: discoveryHint,
            restrictBuiltinTools:
              toolsetName === "none" ? undefined : builtinToolsForCell,
            onProgress: options.onProgress,
          });
        } catch (err) {
          // Per-cell runtime-error containment: a target that throws during
          // its run becomes one NO cell with its (interface, source,
          // toolset) label intact. Earlier versions let one thrown cell
          // collapse the whole matrix scenario into a generic error result
          // that lost cell context. Note: toolset/interface validation
          // throws above this point still bubble to the scenario-level
          // error (those are config errors, not target errors).
          cells.push({
            cell: {
              interface: interfaceName,
              source: sourceName,
              toolset: toolsetName,
            },
            answerable: "NO",
            confidence: 0,
            response: "",
            reason: `Error in cell: ${err instanceof Error ? err.message : String(err)}`,
            citations: null,
            traps: {
              fired: [],
              avoided: (scenario.traps ?? []).map((t) => t.id),
            },
            error: err instanceof Error ? err.message : String(err),
          });
          continue;
        }

        // Score: trap (universal veto) > citation (if requiredSources) +
        // expected (if expected.includes/excludes) + tool-use provenance
        // (non-none cells only). Combine.
        const trapDetails = scoreTraps({
          response: runResult.response,
          traps: scenario.traps ?? [],
        });
        const trapFired = trapDetails.fired.length > 0;

        const citationScore =
          scenario.requiredSources !== undefined && isInjecting
            ? scoreCitations({
                response: runResult.response,
                requiredSources: requiredInCell,
                registeredIds: surfaceIds,
              })
            : null;

        const expectedDetail =
          scenario.expected !== undefined
            ? scoreExpected({
                response: runResult.response,
                expected: scenario.expected,
              })
            : null;

        // Tool-use provenance check. A non-none cell exists to prove the
        // agent reached the answer via the configured toolset; if it
        // answered without invoking any of the expected tools, the cell
        // cannot testify to that axis (the model answered from prior
        // knowledge). Provenance failure is a hard veto with the same
        // shape as trap firing: NO / confidence 0, regardless of what
        // the response happens to say. Skipped when the cell has no
        // configured tools (`allowedForCell` empty), which only happens
        // for `none` cells today.
        const toolUseDetail =
          toolsetName !== "none" && toolMatchers.length > 0
            ? {
                expected: allowedForCell,
                used: (runResult.toolsUsed ?? []).filter((t) =>
                  toolMatchers.some((m) => m(t)),
                ),
              }
            : null;
        const provenanceFailed =
          toolUseDetail !== null && toolUseDetail.used.length === 0;

        // Helper: render the diagnostic notes from citation + expected so
        // a veto reason can still tell the reader what the response said,
        // even when the verdict is forced to NO/0.
        const renderDiagnostics = (): string[] => {
          const notes: string[] = [];
          if (citationScore) notes.push(citationScore.reason);
          if (expectedDetail) {
            const missing = expectedDetail.includes
              .filter((c) => !c.satisfied)
              .map((c) => `"${c.value}"`);
            const banned = expectedDetail.excludes
              .filter((c) => !c.satisfied)
              .map((c) => `"${c.value}"`);
            const expectedNotes: string[] = [];
            if (missing.length > 0) {
              expectedNotes.push(`missing includes: ${missing.join(", ")}`);
            }
            if (banned.length > 0) {
              expectedNotes.push(`hit excludes: ${banned.join(", ")}`);
            }
            notes.push(
              expectedNotes.length > 0
                ? expectedNotes.join("; ")
                : `expected checks satisfied (${expectedDetail.satisfied}/${expectedDetail.total})`,
            );
          }
          return notes.filter((n) => n.length > 0);
        };

        let answerable: Answerable;
        let confidence: number;
        let reason: string;

        if (trapFired) {
          answerable = "NO";
          confidence = 0;
          reason = `Trap fired: ${trapDetails.fired
            .map((t) => `"${t.id}" (${t.reason})`)
            .join("; ")}`;
        } else if (provenanceFailed) {
          // toolUseDetail is non-null here (provenanceFailed implies it).
          const tud = toolUseDetail as NonNullable<typeof toolUseDetail>;
          answerable = "NO";
          confidence = 0;
          const provReason = `Provenance failed: toolset "${toolsetName}" configured but none of [${tud.expected.join(", ")}] were used (answer rests on model prior knowledge)`;
          const diagnostics = renderDiagnostics();
          reason =
            diagnostics.length > 0
              ? `${provReason} | ${diagnostics.join(" | ")}`
              : provReason;
        } else {
          // Compose verdict from citation + expected when both are declared.
          // Score is the average of declared check satisfactions; verdict is
          // the worst of the declared answerables.
          const parts: Array<{ answerable: Answerable; confidence: number }> =
            [];
          const reasons: string[] = [];
          if (citationScore) {
            parts.push({
              answerable: citationScore.answerable,
              confidence: citationScore.confidence,
            });
            reasons.push(citationScore.reason);
          }
          if (expectedDetail) {
            const pct =
              expectedDetail.total === 0
                ? 100
                : Math.round(
                    (expectedDetail.satisfied / expectedDetail.total) * 100,
                  );
            const expectedAnswerable: Answerable =
              pct === 100 ? "YES" : pct === 0 ? "NO" : "PARTIAL";
            parts.push({ answerable: expectedAnswerable, confidence: pct });
            const missing = expectedDetail.includes
              .filter((c) => !c.satisfied)
              .map((c) => `"${c.value}"`);
            const banned = expectedDetail.excludes
              .filter((c) => !c.satisfied)
              .map((c) => `"${c.value}"`);
            const expectedNotes: string[] = [];
            if (missing.length > 0) {
              expectedNotes.push(`missing includes: ${missing.join(", ")}`);
            }
            if (banned.length > 0) {
              expectedNotes.push(`hit excludes: ${banned.join(", ")}`);
            }
            reasons.push(
              expectedNotes.length > 0
                ? expectedNotes.join("; ")
                : `expected checks satisfied (${expectedDetail.satisfied}/${expectedDetail.total})`,
            );
          }
          if (toolUseDetail) {
            // Verified branch only: provenance failure was vetoed above.
            reasons.push(
              `tool use verified (${toolUseDetail.used.join(", ")})`,
            );
          }
          if (parts.length === 0) {
            // No actionable contract aside from traps. Validator should reject
            // this at load; if it slipped through, treat as YES (no trap fired).
            answerable = "YES";
            confidence = 100;
            reason = "No traps fired; no other contract declared";
          } else {
            // Worst verdict; average confidence.
            const rank: Record<Answerable, number> = {
              YES: 0,
              PARTIAL: 1,
              NO: 2,
            };
            const worst = parts.reduce((acc, p) =>
              rank[p.answerable] > rank[acc.answerable] ? p : acc,
            );
            answerable = worst.answerable;
            confidence = Math.round(
              parts.reduce((sum, p) => sum + p.confidence, 0) / parts.length,
            );
            reason = reasons.filter((r) => r.length > 0).join(" | ");
          }
        }

        cells.push({
          cell: {
            interface: interfaceName,
            source: sourceName,
            toolset: toolsetName,
          },
          answerable,
          confidence,
          response: runResult.response,
          reason,
          citations: citationScore ? citationScore.citations : null,
          traps: trapDetails,
          expected: expectedDetail
            ? {
                includes: expectedDetail.includes,
                excludes: expectedDetail.excludes,
                satisfied: expectedDetail.satisfied,
                total: expectedDetail.total,
              }
            : undefined,
          toolsUsed: runResult.toolsUsed,
          allResponses: runResult.allResponses,
        });

        metadata = runResult.metadata ?? metadata;
      }
    }
  }

  // Verifier samples: load registered sources named in scenario.verifiers.sources
  // and attach for human-side comparison in the report. Never injected into
  // the agent's prompt; never LLM-judged.
  const verifierSamples = collectVerifierSamples(scenario, docs);

  return {
    scenario,
    answerable: null,
    confidence: null,
    response: null,
    reason: null,
    citations: null,
    traps: null,
    cells,
    verifierSamples,
    target: metadata,
    context: { name: contextName },
  };
}

function collectVerifierSamples(
  scenario: Scenario,
  docs: ResolvedDocSource[],
): Array<{ id: string; name: string; content: string }> | undefined {
  const ids = scenario.verifiers?.sources;
  if (!ids || ids.length === 0) return undefined;
  const byId = new Map(docs.map((d) => [d.id, d] as const));
  const samples: Array<{ id: string; name: string; content: string }> = [];
  for (const id of ids) {
    const d = byId.get(id);
    if (!d) continue;
    samples.push({ id: d.id, name: d.name, content: d.content });
  }
  return samples.length > 0 ? samples : undefined;
}

/**
 * Build the per-cell prompt. Controlled-mode cells (toolset: none) use the
 * scenario's prompt verbatim because the citation prompt (built by the
 * target adapter) injects the source content. Discovery-mode cells
 * (toolset: web with WebSearch/WebFetch on Claude Code) prepend a hint
 * naming the canonical source the agent should research with its tools.
 * The agent is free to use other discovery paths too; the hint just
 * surfaces the cell's declared source.
 */
function buildCellPrompt(
  basePrompt: string,
  sourceName: string | null,
  docs: ResolvedDocSource[],
  isInjecting: boolean,
): string {
  if (isInjecting) return basePrompt;
  if (sourceName === null) return basePrompt;
  const source = docs.find((d) => d.id === sourceName);
  if (!source) return basePrompt;
  const hint =
    source.type === "url"
      ? `The canonical source for this question is the documentation at ${source.source}. Use your available tools to research it.`
      : `The canonical source for this question is "${source.name}" (registered locally as ${source.id}). Use your available tools to research from authoritative sources.`;
  return `${basePrompt}\n\n${hint}`;
}

/**
 * Resolve a discovery hint string from the cell's active source. Returns
 * the URL for URL sources (the agent can WebFetch it directly), or the
 * human-readable name for file sources (the agent uses WebSearch to find
 * the canonical equivalent on the public web), or null when no source is
 * declared for the cell.
 */
function buildDiscoveryHint(
  sourceName: string | null,
  docs: ResolvedDocSource[],
): string | null {
  if (sourceName === null) return null;
  const source = docs.find((d) => d.id === sourceName);
  if (!source) return null;
  if (source.type === "url") return source.source;
  return source.name;
}
