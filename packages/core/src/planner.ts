import type {
  CheckConfig,
  ResolvedDocSource,
  Scenario,
  ScenarioMatrix,
} from "@pickled-dev/config";
import type { CheckReport, ToolInfo } from "./types.js";

/**
 * Sentinel target name for matrix-mode scenarios. `expandMatrix` emits one
 * entry per context with this name; the matrix branch in the runner owns the
 * interface axis and creates per-cell targets.
 */
export const MATRIX_SENTINEL = "__matrix__";

interface ExpandedScenario {
  scenario: Scenario;
  targetName: string;
  contextName: string;
}

/**
 * Per-axis matrix cell filter. When a field is set, only cells matching it
 * survive planning; omit a field to include every value on that axis.
 */
export interface CellFilter {
  interface?: string;
  access?: string;
  source?: string;
  toolset?: string;
}

/**
 * One concrete cell that the matrix expansion produces. Matrix cells
 * carry interface/source/toolset; non-matrix (single-target) scenarios
 * carry target/context. The two shapes are distinguished by `kind`.
 */
export interface PlannedCell {
  scenario: string;
  kind: "matrix" | "single";
  interface?: string;
  access?: string;
  source?: string | null;
  toolset?: string;
  target?: string;
  context?: string;
}

export function expandMatrix(config: CheckConfig): ExpandedScenario[] {
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

// Cell pairs for a matrix scenario: explicit accessPairs if declared,
// otherwise the legacy sources × toolsets cross-product. Shared by the planner
// and the runner so they expand identically.
export function matrixCellPairs(
  matrix: ScenarioMatrix,
): Array<{ access?: string; source: string | null; toolset: string }> {
  if (matrix.accessPairs) return matrix.accessPairs;
  const sources: Array<string | null> = matrix.sources ?? [null];
  const toolsets = matrix.toolsets ?? ["none"];
  return sources.flatMap((source) =>
    toolsets.map((toolset) => ({ source, toolset })),
  );
}

/**
 * Walk the expanded scenarios and enumerate every concrete cell, applying
 * the per-axis `cellFilter`. Matrix scenarios fan out into one `PlannedCell`
 * per surviving (interface × source × toolset) tuple; non-matrix scenarios
 * become a single `PlannedCell` per (target, context) combination. The output
 * preserves scenario insertion order so the plan grid and the run grid match.
 */
export function planMatrixCells(
  expanded: ExpandedScenario[],
  cellFilter: CellFilter,
): PlannedCell[] {
  const cells: PlannedCell[] = [];
  for (const { scenario, targetName, contextName } of expanded) {
    if (scenario.matrix && targetName === MATRIX_SENTINEL) {
      const matrix = scenario.matrix;
      const defaultInterface = scenario.target ?? "default";
      const interfaces = matrix.interfaces ?? [defaultInterface];
      // Explicit access pairs win; otherwise fall back to the sources ×
      // toolsets cross-product (legacy/internal callers). The public `access`
      // model compiles to accessPairs.
      const pairs = matrixCellPairs(matrix);
      for (const interfaceName of interfaces) {
        if (cellFilter.interface && cellFilter.interface !== interfaceName) {
          continue;
        }
        for (const cellPair of pairs) {
          const accessName = cellPair.access;
          const sourceName = cellPair.source;
          const toolsetName = cellPair.toolset;
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
          cells.push({
            scenario: scenario.name,
            kind: "matrix",
            interface: interfaceName,
            access: accessName,
            source: sourceName,
            toolset: toolsetName,
          });
        }
      }
    } else {
      // Non-matrix: one cell per (target, context). Per-axis filters
      // do not apply to non-matrix scenarios (they have no source or
      // toolset axis); to skip a non-matrix scenario, use the question
      // filter instead.
      cells.push({
        scenario: scenario.name,
        kind: "single",
        target: targetName,
        context: contextName,
      });
    }
  }
  return cells;
}

/**
 * Stable identity for a planned cell. Used as the key in the cell-selection
 * set the matrix runner consults when sampling is active.
 */
export function plannedCellKey(c: PlannedCell): string {
  if (c.kind === "matrix") {
    return `m:${c.scenario}\u0001${c.interface}\u0001${c.access ?? ""}\u0001${c.source ?? ""}\u0001${c.toolset}`;
  }
  return `s:${c.scenario}\u0001${c.target}\u0001${c.context}`;
}

/**
 * Build a dry-run report from a planned cell list. No adapter calls,
 * `scenarios: []`, just the plan summary with the cell list inlined.
 */
export function buildPlanReport(args: {
  tool: ToolInfo;
  docs: ResolvedDocSource[];
  expandedCells: number;
  selectedCells: PlannedCell[];
  seed: string | undefined;
}): CheckReport {
  const { tool, docs, expandedCells, selectedCells, seed } = args;
  return {
    tool: { name: tool.name, description: tool.description, path: tool.path },
    docs,
    scenarios: [],
    summary: { total: 0, answered: 0, unanswered: 0, score: 0 },
    plan: {
      expandedCells,
      selectedCells: selectedCells.length,
      seed,
      cells: selectedCells.map((c) =>
        c.kind === "matrix"
          ? {
              scenario: c.scenario,
              interface: c.interface,
              access: c.access,
              source: c.source,
              toolset: c.toolset,
            }
          : {
              scenario: c.scenario,
              target: c.target,
              context: c.context,
            },
      ),
    },
  };
}
