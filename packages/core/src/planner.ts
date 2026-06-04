import type {
  Config,
  Fact,
  Misstatement,
  ResolvedSource,
} from "@pickled-dev/config";
import type { RunReport } from "./types.js";

/** Which family of tasks a run plans. */
export type TaskKind = "question" | "build";

/**
 * Per-axis cell filter. v2 cells have exactly two axes, agent and context, so
 * the matrix machinery (interface/source/toolset, sentinels, accessPairs) is
 * gone: every question and build is one cell per (agent x context).
 */
export interface CellFilter {
  agent?: string;
  context?: string;
}

export interface PlannedCell {
  task: string;
  kind: TaskKind;
  agent: string;
  context: string;
  /**
   * Executions this cell runs: a build cell runs `trials` agent runs; a
   * question cell runs once (question sampling lands later). The cost gate
   * (`--max-cells`) and the plan's execution count expand by this.
   */
  trials: number;
}

/** Trial-expanded execution count: the real unit of work `--max-cells` gates. */
export function cellExecutions(cells: PlannedCell[]): number {
  return cells.reduce((n, c) => n + c.trials, 0);
}

/**
 * Enumerate every (agent x context) cell for the run's task family, applying
 * the cell filter. Insertion order follows task, then agent, then context, so
 * the plan grid and the run grid match.
 */
export function planCells(
  config: Config,
  kind: TaskKind,
  filter: CellFilter,
): PlannedCell[] {
  const cells: PlannedCell[] = [];
  const tasks =
    kind === "question"
      ? config.questions.map((q) => ({
          id: q.id,
          agents: q.agents,
          contexts: q.contexts,
          trials: 1,
        }))
      : config.builds.map((b) => ({
          id: b.id,
          agents: b.agents,
          contexts: b.contexts,
          trials: b.trials,
        }));
  for (const task of tasks) {
    for (const agent of task.agents) {
      if (filter.agent && filter.agent !== agent) continue;
      for (const context of task.contexts) {
        if (filter.context && filter.context !== context) continue;
        cells.push({
          task: task.id,
          kind,
          agent,
          context,
          trials: task.trials,
        });
      }
    }
  }
  return cells;
}

/**
 * Stable identity for a planned cell; the key the sampler's selection set uses.
 * JSON-encoded so component ids cannot collide and no delimiter hides in source.
 */
export function plannedCellKey(c: PlannedCell): string {
  return JSON.stringify([c.kind, c.task, c.agent, c.context]);
}

/**
 * Build a dry-run report from a planned cell list. No adapter calls; the task
 * results are empty and the plan summary carries the inlined cell list.
 */
export function buildPlanReport(args: {
  product: { name: string; description: string };
  sources: ResolvedSource[];
  facts: Record<string, Fact>;
  misstatements: Record<string, Misstatement>;
  kind: TaskKind;
  expandedCells: number;
  expandedExecutions: number;
  selectedCells: PlannedCell[];
  seed: string | undefined;
}): RunReport {
  const {
    product,
    sources,
    facts,
    misstatements,
    kind,
    expandedCells,
    expandedExecutions,
    selectedCells,
    seed,
  } = args;
  return {
    product,
    sources,
    facts,
    misstatements,
    kind: kind === "question" ? "questions" : "builds",
    summary: { total: 0, yes: 0, partial: 0, no: 0, errors: 0, score: 0 },
    plan: {
      expandedCells,
      selectedCells: selectedCells.length,
      expandedExecutions,
      selectedExecutions: cellExecutions(selectedCells),
      seed,
      cells: selectedCells.map((c) => ({
        task: c.task,
        agent: c.agent,
        context: c.context,
        ...(c.trials > 1 ? { trials: c.trials } : {}),
      })),
    },
  };
}
