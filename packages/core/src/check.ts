import type { Config, ResolvedSource, Target } from "@pickled-dev/config";
import { proveBuild, runBuildCell } from "./implement/build-runner.js";
import {
  buildPlanReport,
  type CellFilter,
  cellExecutions,
  type PlannedCell,
  planCells,
  type TaskKind,
} from "./planner.js";
import { runQuestion } from "./question-runner.js";
import { summarizeBuilds, summarizeQuestions } from "./report-status.js";
import { sampleCellsPerTask } from "./sampling.js";
import { fetchAllSources } from "./sources.js";
import type { TargetRunner } from "./targets/types.js";
import type {
  BuildCell,
  BuildProofResult,
  BuildResult,
  QuestionCell,
  QuestionResult,
  RunReport,
  ToolInfo,
} from "./types.js";

export interface CheckOptions {
  onProgress?: (msg: string) => void;
  /** Test seam: build a target from the resolved per-cell config. */
  targetFactory?: (name: string, config: Target) => TargetRunner;
  /** Per-axis cell filter (agent, context). */
  cellFilter?: CellFilter;
  /** Restrict to these task ids. Empty/omitted = all. */
  taskFilter?: string[];
  /** Dry run: plan cells and return without invoking any agent. */
  plan?: boolean;
  /** Hard execution cap (counted after filters + sampling, build trials expanded). */
  maxCells?: number;
  /** Deterministic per-task sample size. */
  sample?: number;
  /** Seed for sampling (default "default"). */
  seed?: string;
  /** Build only: keep failed workspaces for inspection. */
  keepOnFailure?: boolean;
}

/**
 * Run one task family (questions or builds) end to end: load sources, plan the
 * (agent x context) cells, apply task/cell filters + sampling + the cost gate,
 * dispatch to the question or build runner, and assemble the RunReport.
 */
export async function run(
  kind: TaskKind,
  tool: ToolInfo,
  config: Config,
  options: CheckOptions = {},
): Promise<RunReport> {
  const { onProgress } = options;
  const tasks = kind === "question" ? config.questions : config.builds;
  if (tasks.length === 0) {
    throw new Error(
      `No ${kind === "question" ? "questions" : "builds"} defined in pickled.yml`,
    );
  }

  onProgress?.("Loading sources...");
  const sources = await fetchAllSources(config.sources, tool.path, onProgress);

  let cells = planCells(config, kind, options.cellFilter ?? {});
  if (options.taskFilter && options.taskFilter.length > 0) {
    const wanted = new Set(options.taskFilter);
    cells = cells.filter((c) => wanted.has(c.task));
  }
  if (cells.length === 0) {
    throw new Error(
      "No cells matched the selected filters. Check --task, --agent, --context.",
    );
  }

  const expandedCells = cells.length;
  const expandedExecutions = cellExecutions(cells);

  let selected = cells;
  let usedSeed: string | undefined;
  if (options.sample !== undefined) {
    usedSeed = options.seed ?? "default";
    selected = sampleCellsPerTask(cells, options.sample, usedSeed);
  }

  const selectedExecutions = cellExecutions(selected);
  if (options.maxCells !== undefined && selectedExecutions > options.maxCells) {
    throw new Error(
      `Run expands to ${selectedExecutions} executions, exceeding --max-cells ${options.maxCells}. Add --task/--agent/--context filters, pass --sample N, or lower build trials.`,
    );
  }

  if (options.plan) {
    return buildPlanReport({
      product: config.product,
      sources,
      facts: config.facts,
      misstatements: config.misstatements,
      kind,
      expandedCells,
      expandedExecutions,
      selectedCells: selected,
      seed: usedSeed,
    });
  }

  const plan = {
    expandedCells,
    selectedCells: selected.length,
    expandedExecutions,
    selectedExecutions,
    seed: usedSeed,
  };

  return kind === "question"
    ? runQuestions(tool, config, sources, selected, plan, options)
    : runBuilds(tool, config, sources, selected, plan, options);
}

/** `pickled check` entry: questions. */
export function runCheck(
  tool: ToolInfo,
  config: Config,
  options: CheckOptions = {},
): Promise<RunReport> {
  return run("question", tool, config, options);
}

/** `pickled build` entry: builds. */
export function runBuild(
  tool: ToolInfo,
  config: Config,
  options: CheckOptions = {},
): Promise<RunReport> {
  return run("build", tool, config, options);
}

/**
 * `pickled build --verify-only`: prove each build's harness (preflight +
 * reference control) with no agent runs. Per build, not per cell, because the
 * proof is agent/context-independent. Honors a task filter.
 */
export async function proveBuilds(
  tool: ToolInfo,
  config: Config,
  options: { taskFilter?: string[]; onProgress?: (msg: string) => void } = {},
): Promise<BuildProofResult[]> {
  const wanted =
    options.taskFilter && options.taskFilter.length > 0
      ? new Set(options.taskFilter)
      : undefined;
  const builds = wanted
    ? config.builds.filter((b) => wanted.has(b.id))
    : config.builds;
  const results: BuildProofResult[] = [];
  for (const build of builds) {
    options.onProgress?.(`proving "${build.goal}"`);
    const proof = await proveBuild(build, tool.path);
    results.push({
      id: build.id,
      goal: build.goal,
      status: proof.status,
      message: proof.message,
    });
  }
  return results;
}

async function runQuestions(
  tool: ToolInfo,
  config: Config,
  sources: ResolvedSource[],
  selected: PlannedCell[],
  plan: RunReport["plan"],
  options: CheckOptions,
): Promise<RunReport> {
  const byTask = groupByTask(selected);
  const results: QuestionResult[] = [];
  const allCells: QuestionCell[] = [];
  for (const [taskId, cells] of byTask) {
    const question = config.questions.find((q) => q.id === taskId);
    if (!question) continue;
    options.onProgress?.(`"${question.question}"`);
    const result = await runQuestion({
      question,
      cells: cells.map((c) => ({
        agent: c.agent,
        context: c.context,
        trials: c.trials,
      })),
      config,
      sources,
      options: {
        tool,
        targetFactory: options.targetFactory,
        onProgress: options.onProgress,
      },
    });
    results.push(result);
    allCells.push(...result.cells);
  }
  return {
    product: config.product,
    sources,
    facts: config.facts,
    misstatements: config.misstatements,
    kind: "questions",
    questions: results,
    summary: summarizeQuestions(allCells),
    threshold: config.thresholds.questions,
    plan,
  };
}

async function runBuilds(
  tool: ToolInfo,
  config: Config,
  sources: ResolvedSource[],
  selected: PlannedCell[],
  plan: RunReport["plan"],
  options: CheckOptions,
): Promise<RunReport> {
  const byTask = groupByTask(selected);
  const results: BuildResult[] = [];
  const allCells: BuildCell[] = [];
  for (const [taskId, cells] of byTask) {
    const build = config.builds.find((b) => b.id === taskId);
    if (!build) continue;
    options.onProgress?.(`"${build.goal}"`);
    const buildCells: BuildCell[] = [];
    for (const cell of cells) {
      buildCells.push(
        await runBuildCell({
          build,
          agent: cell.agent,
          contextName: cell.context,
          config,
          sources,
          options: {
            tool,
            targetFactory: options.targetFactory,
            keepOnFailure: options.keepOnFailure,
            onProgress: options.onProgress,
          },
        }),
      );
    }
    results.push({ id: build.id, goal: build.goal, cells: buildCells });
    allCells.push(...buildCells);
  }
  return {
    product: config.product,
    sources,
    facts: config.facts,
    misstatements: config.misstatements,
    kind: "builds",
    builds: results,
    summary: summarizeBuilds(allCells),
    threshold: config.thresholds.builds,
    plan,
  };
}

function groupByTask(cells: PlannedCell[]): Map<string, PlannedCell[]> {
  const byTask = new Map<string, PlannedCell[]>();
  for (const c of cells) {
    const list = byTask.get(c.task);
    if (list) list.push(c);
    else byTask.set(c.task, [c]);
  }
  return byTask;
}
