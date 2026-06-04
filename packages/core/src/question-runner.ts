import type {
  Config,
  Context,
  Question,
  ResolvedSource,
  Target,
} from "@pickled-dev/config";
import { resolveCellRuntime } from "./cell-runtime.js";
import { aggregateQuestionCell, scoreQuestionTrial } from "./scorers/index.js";
import { createTarget } from "./targets/index.js";
import type { TargetRunner } from "./targets/types.js";
import type {
  CellCoord,
  QuestionCell,
  QuestionResult,
  QuestionTrial,
  ToolInfo,
} from "./types.js";

export interface QuestionRunOptions {
  tool: ToolInfo;
  /** Test seam: build a target from the resolved per-cell config. */
  targetFactory?: (name: string, config: Target) => TargetRunner;
  onProgress?: (msg: string) => void;
}

/** Source id a context names, or null (memory, or web/mcp without a source). */
function contextSource(context: Context): string | null {
  return context.mode === "memory" ? null : (context.source ?? null);
}

/**
 * Run one question cell: one (agent x context), `trials` independent runs,
 * scored and aggregated into a QuestionCell. A provider-gate failure (e.g. web
 * on codex) or a thrown run becomes an error trial; an all-error cell carries
 * `error` and is counted under summary.errors.
 */
export async function runQuestionCell(args: {
  question: Question;
  agent: string;
  contextName: string;
  trials: number;
  config: Config;
  sources: ResolvedSource[];
  options: QuestionRunOptions;
}): Promise<QuestionCell> {
  const { question, agent, contextName, trials, config, sources, options } =
    args;
  const coord: CellCoord = { agent, context: contextName };
  const context = config.contexts[contextName];
  if (!context) {
    return errorCell(coord, "memory", null, `unknown context "${contextName}"`);
  }

  let rt: ReturnType<typeof resolveCellRuntime>;
  try {
    rt = resolveCellRuntime({
      agent,
      context,
      config,
      sources,
      kind: "question",
    });
  } catch (e) {
    return errorCell(coord, context.mode, contextSource(context), errMsg(e));
  }

  const target = options.targetFactory
    ? options.targetFactory(agent, rt.target)
    : createTarget(agent, rt.target);

  const trialResults: QuestionTrial[] = [];
  for (let i = 0; i < trials; i++) {
    try {
      const result = await target.run(question.question, {
        tool: options.tool,
        cwd: options.tool.path,
        promptContext: rt.promptContext,
        restrictBuiltinTools: rt.runOptions.restrictBuiltinTools,
        webTools: rt.runOptions.webTools,
        mcpTools: rt.runOptions.mcpTools,
        onProgress: options.onProgress,
      });
      const scored = scoreQuestionTrial({
        response: result.response,
        toolsUsed: result.toolsUsed ?? [],
        expects: question.expects,
        rejects: question.rejects,
        facts: config.facts,
        misstatements: config.misstatements,
        provenance: rt.provenance,
      });
      trialResults.push({ ...scored, allResponses: result.allResponses });
    } catch (e) {
      trialResults.push({ status: "error", error: errMsg(e) });
    }
  }

  return aggregateQuestionCell({
    coord,
    mode: rt.mode,
    source: rt.sourceId,
    trials: trialResults,
  });
}

/**
 * Run every (agent x context) cell of a question into a QuestionResult. The
 * caller supplies the already-planned/sampled cells (agent + context pairs)
 * for this question.
 */
export async function runQuestion(args: {
  question: Question;
  cells: Array<{ agent: string; context: string; trials: number }>;
  config: Config;
  sources: ResolvedSource[];
  options: QuestionRunOptions;
}): Promise<QuestionResult> {
  const cells: QuestionCell[] = [];
  for (const cell of args.cells) {
    cells.push(
      await runQuestionCell({
        question: args.question,
        agent: cell.agent,
        contextName: cell.context,
        trials: cell.trials,
        config: args.config,
        sources: args.sources,
        options: args.options,
      }),
    );
  }
  return { id: args.question.id, question: args.question.question, cells };
}

function errorCell(
  coord: CellCoord,
  mode: QuestionCell["mode"],
  source: string | null,
  error: string,
): QuestionCell {
  return {
    coord,
    mode,
    source,
    verdict: "NO",
    passedTrials: 0,
    totalTrials: 0,
    passRate: 0,
    meanCoverage: 0,
    trials: [],
    reason: error,
    error,
  };
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
