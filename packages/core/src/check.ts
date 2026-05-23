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
 * v0.16.0: only `toolset = "none"` has runtime behavior. Non-none toolsets
 * throw "not yet implemented" so vendors are not misled by silent no-ops.
 * Adapter implementations land in follow-up commits.
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
        if (toolsetName !== "none") {
          throw new Error(
            `Toolset "${toolsetName}" is declared but not yet implemented in this CLI version. v0.16.0 supports only "none" (the deterministic baseline cell). Tool-enabled adapters (WebSearch+WebFetch, Context7 MCP, Firecrawl, native API search) land in follow-up commits.`,
          );
        }

        const { config: targetConfig } = resolveTarget(
          interfaceName,
          config.targets,
        );
        const target = options.targetFactory
          ? options.targetFactory(interfaceName, targetConfig)
          : createTarget(interfaceName, targetConfig);

        // Source × Toolset semantics (matrix proposal Decision 6):
        // Tools: none + source -> inject the source content.
        // Verifiers.sources are loaded into the registry but never injected
        // unless they are also the active source.
        const cellDocs =
          sourceName === null ? docs : docs.filter((d) => d.id === sourceName);
        const surfaceIds =
          sourceName === null ? docs.map((d) => d.id) : [sourceName];
        const required = scenario.requiredSources ?? [];
        const requiredInCell = required.filter((id) => surfaceIds.includes(id));

        const runResult = await target.run(scenario.prompt, {
          tool,
          cwd: tool.path,
          context: contextConfig,
          docs: cellDocs,
          requiredSources: requiredInCell,
          onProgress: options.onProgress,
        });

        // Score: trap (universal veto) > citation (if requiredSources) +
        // expected (if expected.includes/excludes). Combine.
        const trapDetails = scoreTraps({
          response: runResult.response,
          traps: scenario.traps ?? [],
        });
        const trapFired = trapDetails.fired.length > 0;

        const citationScore =
          scenario.requiredSources !== undefined
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

        let answerable: Answerable;
        let confidence: number;
        let reason: string;

        if (trapFired) {
          answerable = "NO";
          confidence = 0;
          reason = `Trap fired: ${trapDetails.fired
            .map((t) => `"${t.id}" (${t.reason})`)
            .join("; ")}`;
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
