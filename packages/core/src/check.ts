import type {
  CheckConfig,
  ResolvedDocSource,
  Scenario,
  ScenarioMatrix,
} from "@pickled-dev/config";
import { resolveCellRuntime } from "./cell-runtime.js";
import {
  buildPlanReport,
  type CellFilter,
  expandMatrix,
  MATRIX_SENTINEL,
  matrixCellPairs,
  planMatrixCells,
  plannedCellKey,
} from "./planner.js";
import { summarizeReadiness } from "./readiness.js";
import { getScenarioStatus } from "./report-status.js";
import { sampleCellsPerScenario } from "./sampling.js";
import {
  type Answerable,
  formatExistenceNotes,
  formatExpectedNotes,
  scoreCitations,
  scoreExpected,
  verifyExpectedExistence,
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
   * where each CI job runs one narrowed slice.
   * Each filter accepts a single name; omit to include all cells on that axis.
   */
  cellFilter?: CellFilter;
  /** Restrict to scenarios with these names. Empty/omitted = all scenarios. */
  scenarioFilter?: string[];
  /**
   * Dry-run mode. Walk the matrix expansion, apply filters and
   * sampling, then return without invoking any adapter. The returned
   * report has `scenarios: []` and the `plan` summary populated. Cheap
   * pre-flight to see exactly what a run would do.
   */
  plan?: boolean;
  /**
   * Hard cell-count cap. Counted AFTER filters and sampling. If the
   * remaining cell total exceeds this number, runCheck throws before
   * any adapter is invoked. The error message names the count and
   * suggests filters or `--sample`.
   */
  maxCells?: number;
  /**
   * Deterministic per-scenario sample size. Picks up to N cells per
   * matrix scenario (single-cell scenarios always run). Reproducible
   * via `seed`; the default seed is the literal string "default" so
   * re-runs without `--seed` are reproducible.
   */
  sample?: number;
  /** Seed for `sample`. Defaults to "default" so the same matrix and
   *  sample size always produce the same cells. */
  seed?: string;
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
    docs = await fetchAllSources(sourcesMap, tool.path, onProgress);
    for (const d of docs) {
      onProgress?.(`  [${d.id}] ${d.name}`);
    }
    onProgress?.("");
  }

  const registeredIds = docs.map((d) => d.id);
  let expanded = expandMatrix(config);

  // Apply question name filter (stored internally as scenario names).
  if (options.scenarioFilter && options.scenarioFilter.length > 0) {
    const wanted = new Set(options.scenarioFilter);
    expanded = expanded.filter((e) => wanted.has(e.scenario.name));
    if (expanded.length === 0) {
      throw new Error(
        `No scenarios matched filter: ${[...wanted].join(", ")}. Declared scenarios: ${config.scenarios.map((s) => s.name).join(", ")}`,
      );
    }
  }

  // Plan + sample + max-cells pre-flight. Walks the matrix expansion
  // once to enumerate every concrete cell that would run, then
  // applies sampling and the max-cells gate before any adapter call.
  const cellFilter = options.cellFilter ?? {};
  const expandedCells = planMatrixCells(expanded, cellFilter);
  if (expandedCells.length === 0) {
    throw new Error(
      "No cells matched the selected filters. Check --question, --agent, and --access.",
    );
  }
  let selectedCells = expandedCells;
  let usedSeed: string | undefined;
  if (options.sample !== undefined) {
    const seed = options.seed ?? "default";
    // Sample only the matrix cells; single-cell (non-matrix) scenarios
    // are 1-of-1 already and run unconditionally so the user can rely
    // on them as deterministic anchors.
    const matrixCells = expandedCells.filter((c) => c.kind === "matrix");
    const sampledMatrix = sampleCellsPerScenario(
      matrixCells,
      options.sample,
      seed,
    );
    const sampledSet = new Set(sampledMatrix.map(plannedCellKey));
    selectedCells = expandedCells.filter(
      (c) => c.kind !== "matrix" || sampledSet.has(plannedCellKey(c)),
    );
    usedSeed = seed;
  }

  if (
    options.maxCells !== undefined &&
    selectedCells.length > options.maxCells
  ) {
    throw new Error(
      `Matrix expands to ${selectedCells.length} cells, exceeding --max-cells ${options.maxCells}. Add --question/--agent/--access filters, or pass --sample N to sample per question.`,
    );
  }

  if (options.plan) {
    return buildPlanReport({
      tool,
      docs,
      expandedCells: expandedCells.length,
      selectedCells,
      seed: usedSeed,
    });
  }

  const matrixCellSelection =
    options.sample !== undefined
      ? new Set(
          selectedCells.filter((c) => c.kind === "matrix").map(plannedCellKey),
        )
      : undefined;

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
        matrixCellSelection,
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
  const report = buildReport(tool, docs, results);
  // Stamp the plan summary on every run so the receipt records what was
  // expanded, what was sampled, and the seed used. `cells` is omitted
  // outside plan-mode reports; reviewers see counts + seed in the
  // header and look to `scenarios` for per-cell receipts.
  report.plan = {
    expandedCells: expandedCells.length,
    selectedCells: selectedCells.length,
    seed: usedSeed,
  };
  // Stamp the readiness summary (#22 / step 4 of #19) only when at
  // least one diagnostic pattern applied. A scenario suite with no
  // matrix scenarios and no readiness signals produces an empty
  // diagnostics array; surfacing `readiness: { diagnostics: [] }` in
  // every receipt would clutter the output. Omit the field when empty
  // so receipts without diagnostics keep a lean JSON shape.
  const readiness = summarizeReadiness(report);
  if (readiness.diagnostics.length > 0) {
    report.readiness = readiness;
  }
  return report;
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
  matrixCellSelection?: Set<string>,
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
      matrixCellSelection,
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
  // stay null because each surface owns its own result block.
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

      surfaces.push({
        active: surface,
        answerable: citationScore.answerable,
        confidence: citationScore.confidence,
        response: runResult.response,
        reason: citationScore.reason,
        citations: citationScore.citations,
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

  // Score: citation (if requiredSources declared) + expected (if expected
  // declared). Composition matches matrix mode so single-mode and
  // matrix-mode treat the same contract the same way.
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
  if (expectedDetail) {
    verifyExpectedExistence(expectedDetail, docs);
  }

  let answerable: Answerable;
  let confidence: number;
  let reason: string;
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
    // Per-group expected notes (which key missed) and codebase-existence
    // hygiene notes, so the reason names what failed rather than going
    // blank when only expected checks are declared.
    reasons.push(...formatExpectedNotes(expectedDetail));
    reasons.push(...formatExistenceNotes(expectedDetail));
  }
  if (parts.length === 0) {
    // Validator should reject this; if it slips through, treat as YES.
    answerable = "YES";
    confidence = 100;
    reason = "No contract declared";
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

  return {
    scenario,
    answerable,
    confidence,
    response: result.response,
    reason,
    citations: citationScore
      ? citationScore.citations
      : { cited: [], required, missing: [], unknown: [] },
    expected: expectedDetail
      ? {
          includes: expectedDetail.includes,
          excludes: expectedDetail.excludes,
          symbols: expectedDetail.symbols,
          paths: expectedDetail.paths,
          options: expectedDetail.options,
          constraints: expectedDetail.constraints,
          mustMentionOneOf: expectedDetail.mustMentionOneOf,
          satisfied: expectedDetail.satisfied,
          total: expectedDetail.total,
        }
      : undefined,
    target: result.metadata,
    context: { name: contextName },
    toolsUsed: result.toolsUsed,
    sources: result.sources,
    allResponses: result.allResponses,
  };
}

export function buildReport(
  tool: ToolInfo,
  docs: ResolvedDocSource[],
  results: ScenarioResult[],
): CheckReport {
  // Each "evaluation" is one data point in the score average. Compare-mode
  // results contribute one evaluation per surface; single-mode results
  // contribute one.
  type Eval = {
    answerable: "YES" | "PARTIAL" | "NO";
    confidence: number;
    /** Build cells score by their pass rate directly (confidence IS the rate),
     *  not the answer-mode YES=conf / PARTIAL=conf*0.5 curve. */
    isBuild?: boolean;
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
        // A build cell with no `build` block is an Error (setup failure,
        // vacuous fixture, all trials errored): an environment problem, not the
        // agent failing, so it is excluded from scoring entirely. A scored
        // build cell - including a 0/n NO - keeps its `build` block and counts.
        if (c.taskKind === "build" && c.build === undefined) continue;
        evals.push({
          answerable: c.answerable,
          confidence: c.confidence,
          isBuild: c.build !== undefined,
        });
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
            // Build cells: confidence is the pass rate; count it directly so a
            // PARTIAL 2/3 scores 67, not 67 * 0.5.
            if (e.isBuild) return sum + e.confidence;
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
 * the `web` shape (`webSearch`/`webFetch` flags) on Claude Code (client
 * `WebSearch`/`WebFetch`), the Anthropic API target (server-side
 * `web_search`), and the OpenAI API target (server-side `web_search`);
 * the `mcp` shape (`mcpServers` map) on Claude Code (Agent SDK native)
 * and on the OpenAI API target (hosted-MCP on `responses.create`, HTTP
 * transports only). Toolsets with no recognized shape, mixed shapes
 * (web flags + mcpServers), or an unsupported provider for the
 * requested shape throw with a clear per-cell error so misconfigurations
 * are not masked by silent no-ops; further adapters land per release.
 */
async function runMatrixScenario(
  scenario: Scenario,
  contextName: string,
  tool: ToolInfo,
  config: CheckConfig,
  docs: ResolvedDocSource[],
  options: CheckOptions,
  matrixCellSelection?: Set<string>,
): Promise<ScenarioResult> {
  const { config: contextConfig } = resolveContext(
    contextName,
    config.contexts,
  );

  const matrix = scenario.matrix ?? {};
  const defaultInterface = scenario.target ?? "default";
  const interfaces = matrix.interfaces ?? [defaultInterface];
  const pairs = matrixCellPairs(matrix);

  const cellFilter = options.cellFilter ?? {};

  const cells: CellResult[] = [];
  let metadata: ScenarioResult["target"];

  for (const interfaceName of interfaces) {
    if (cellFilter.interface && cellFilter.interface !== interfaceName) {
      continue;
    }
    for (const cellPair of pairs) {
      const sourceName = cellPair.source;
      const toolsetName = cellPair.toolset;
      const accessName = cellPair.access;
      if (cellFilter.access && cellFilter.access !== accessName) {
        continue;
      }
      if (
        cellFilter.source !== undefined &&
        cellFilter.source !== (sourceName ?? "")
      ) {
        continue;
      }
      if (cellFilter.toolset && cellFilter.toolset !== toolsetName) {
        continue;
      }
      // Cell selection from upstream sampling. When `--sample N` is
      // active, runCheck pre-computes a Set of cells that survived the
      // sample; cells outside the set are skipped silently here so the
      // matrix shape stays honest (same axes, fewer cells run).
      if (matrixCellSelection !== undefined) {
        const key = `m:${scenario.name}\u0001${interfaceName}\u0001${accessName ?? ""}\u0001${sourceName ?? ""}\u0001${toolsetName}`;
        if (!matrixCellSelection.has(key)) continue;
      }

      // Cell runtime prep (target config, source injection, tool scoping,
      // provenance matcher) is shared with the build runner. Called outside the
      // per-cell try so provider-gate validation errors bubble to the scenario
      // error rather than collapsing into one NO cell.
      const rt = resolveCellRuntime({
        interfaceName,
        sourceName,
        toolsetName,
        config,
        docs,
        requiredSources: scenario.requiredSources ?? [],
        contextConfig,
      });

      const target = options.targetFactory
        ? options.targetFactory(interfaceName, rt.targetConfig)
        : createTarget(interfaceName, rt.targetConfig);

      const effectivePrompt = buildCellPrompt(
        scenario.prompt,
        sourceName,
        docs,
        rt.isInjecting,
      );

      let runResult: Awaited<ReturnType<typeof target.run>>;
      try {
        // The cell's toolset declaration is the single source of truth for its
        // available tools; resolveCellRuntime already decided context, docs,
        // and tool scoping so the cell label honestly describes what the agent
        // had available.
        runResult = await target.run(effectivePrompt, {
          tool,
          cwd: tool.path,
          context: rt.cellContext,
          docs: rt.cellDocs,
          requiredSources: rt.requiredInCell,
          discovery: rt.discoveryHint,
          restrictBuiltinTools: rt.runOptions.restrictBuiltinTools,
          webTools: rt.runOptions.webTools,
          mcpTools: rt.runOptions.mcpTools,
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
            access: accessName,
            source: sourceName,
            toolset: toolsetName,
          },
          taskKind: "answer",
          answerable: "NO",
          confidence: 0,
          response: "",
          reason: `Error in cell: ${err instanceof Error ? err.message : String(err)}`,
          citations: null,
          error: err instanceof Error ? err.message : String(err),
        });
        continue;
      }

      // Score: citation (if requiredSources) + expected (if
      // expected.includes/excludes) + tool-use provenance (non-none cells
      // only). Combine.
      const citationScore =
        scenario.requiredSources !== undefined && rt.isInjecting
          ? scoreCitations({
              response: runResult.response,
              requiredSources: rt.requiredInCell,
              registeredIds: rt.surfaceIds,
            })
          : null;

      const expectedDetail =
        scenario.expected !== undefined
          ? scoreExpected({
              response: runResult.response,
              expected: scenario.expected,
            })
          : null;
      if (expectedDetail) {
        verifyExpectedExistence(expectedDetail, docs);
      }

      // Tool-use provenance check. A non-none cell exists to prove the
      // agent reached the answer via the configured toolset; if it
      // answered without invoking any of the expected tools, the cell
      // cannot testify to that axis (the model answered from prior
      // knowledge). Provenance failure is a hard veto: NO / confidence 0,
      // regardless of what the response happens to say. Skipped when the cell
      // has no provenance matchers (rt.provenance.hasMatchers false), which
      // only happens for `none` cells today.
      const toolUseDetail =
        toolsetName !== "none" && rt.provenance.hasMatchers
          ? {
              expected: rt.provenance.expectedLabels,
              used: (runResult.toolsUsed ?? []).filter((t) =>
                rt.provenance.match(t),
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
          notes.push(...formatExpectedNotes(expectedDetail));
          notes.push(...formatExistenceNotes(expectedDetail));
        }
        return notes.filter((n) => n.length > 0);
      };

      let answerable: Answerable;
      let confidence: number;
      let reason: string;

      if (provenanceFailed) {
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
              : Math.round(
                  (expectedDetail.satisfied / expectedDetail.total) * 100,
                );
          const expectedAnswerable: Answerable =
            pct === 100 ? "YES" : pct === 0 ? "NO" : "PARTIAL";
          parts.push({ answerable: expectedAnswerable, confidence: pct });
          reasons.push(...formatExpectedNotes(expectedDetail));
          // Hygiene-only: existence misses do not change the cell
          // verdict, but the note tells the vendor a declared
          // symbol/path is fictional or stale.
          reasons.push(...formatExistenceNotes(expectedDetail));
        }
        if (toolUseDetail) {
          // Verified branch only: provenance failure was vetoed above.
          reasons.push(`tool use verified (${toolUseDetail.used.join(", ")})`);
        }
        if (parts.length === 0) {
          // No actionable contract. Validator should reject this at load;
          // if it slipped through, treat as YES.
          answerable = "YES";
          confidence = 100;
          reason = "No contract declared";
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
          access: accessName,
          source: sourceName,
          toolset: toolsetName,
        },
        taskKind: "answer",
        answerable,
        confidence,
        response: runResult.response,
        reason,
        citations: citationScore ? citationScore.citations : null,
        expected: expectedDetail
          ? {
              includes: expectedDetail.includes,
              excludes: expectedDetail.excludes,
              symbols: expectedDetail.symbols,
              paths: expectedDetail.paths,
              options: expectedDetail.options,
              constraints: expectedDetail.constraints,
              mustMentionOneOf: expectedDetail.mustMentionOneOf,
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
 * target adapter) injects the source content. Discovery-mode cells (any
 * non-none toolset: web on Claude Code via WebSearch/WebFetch, web on
 * the Anthropic or OpenAI API targets via server-side web_search, or mcp
 * via the configured MCP server) prepend a hint naming the canonical
 * source the agent should research with its tools. The agent is free to
 * use other discovery paths too; the hint just surfaces the cell's
 * declared source.
 */
function buildCellPrompt(
  basePrompt: string,
  sourceName: string | null,
  docs: ResolvedDocSource[],
  isInjecting: boolean,
): string {
  if (isInjecting) return basePrompt;
  // sourceName `null` (no matrix.sources axis) or the reserved "none"
  // sentinel both mean "no canonical source to point at"; the agent
  // gets the bare scenario prompt and discovers (or doesn't) from
  // scratch with whatever tools it has.
  if (sourceName === null || sourceName === "none") return basePrompt;
  const source = docs.find((d) => d.id === sourceName);
  if (!source) return basePrompt;
  const hint =
    source.type === "url"
      ? `The canonical source for this question is the documentation at ${source.source}. Use your available tools to research it.`
      : `The canonical source for this question is "${source.name}" (registered locally as ${source.id}). Use your available tools to research from authoritative sources.`;
  return `${basePrompt}\n\n${hint}`;
}
