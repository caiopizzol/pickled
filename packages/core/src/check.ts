import type {
  CheckConfig,
  ResolvedDocSource,
  Scenario,
} from "@pickled-dev/config";
import { scoreCitations, scoreTraps } from "./scorers/index.js";
import { fetchAllSources } from "./sources.js";
import {
  createTarget,
  DEFAULT_TARGET,
  resolveContext,
  resolveTarget,
  type TargetRunner,
} from "./targets/index.js";
import type { CheckReport, ScenarioResult, ToolInfo } from "./types.js";

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
    const targets = scenario.target ? [scenario.target] : matrixTargets;
    const contexts = scenario.context ? [scenario.context] : matrixContexts;
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
  const expanded = expandMatrix(config);
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
      const { icon, status } = formatResultStatus(result);
      onProgress?.(
        `  ${labelPadded} ${icon} ${status} (${result.confidence}%)`,
      );
    } catch (error) {
      const targetConfig =
        targetName === "default"
          ? DEFAULT_TARGET
          : (config.targets?.[targetName] ?? DEFAULT_TARGET);
      const errorResult: ScenarioResult = {
        scenario,
        answerable: "NO",
        confidence: 0,
        response: "",
        reason: "Error during run",
        citations: {
          cited: [],
          required: scenario.requiredSources,
          missing: scenario.requiredSources,
          unknown: [],
        },
        traps: {
          fired: [],
          avoided: (scenario.traps ?? []).map((t) => t.id),
        },
        error: error instanceof Error ? error.message : String(error),
        target: {
          target: targetName,
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

function formatResultStatus(result: ScenarioResult): {
  icon: string;
  status: string;
} {
  if (result.error) return { icon: "✗", status: "Error" };
  if (result.traps.fired.length > 0) {
    return { icon: "✗", status: "Trap fired" };
  }
  if (result.answerable === "YES") {
    return result.confidence >= 90
      ? { icon: "✓", status: "Well grounded" }
      : { icon: "✓", status: "Grounded" };
  }
  if (result.answerable === "PARTIAL") {
    return { icon: "⚠", status: "Partially grounded" };
  }
  return { icon: "✗", status: "Ungrounded" };
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
  const { config: targetConfig } = resolveTarget(targetName, config.targets);
  const { config: contextConfig } = resolveContext(
    contextName,
    config.contexts,
  );

  const target = options.targetFactory
    ? options.targetFactory(targetName, targetConfig)
    : createTarget(targetName, targetConfig);

  const result = await target.run(scenario.prompt, {
    tool,
    cwd: tool.path,
    context: contextConfig,
    docs,
    requiredSources: scenario.requiredSources,
    onProgress: options.onProgress,
  });

  const citationScore = scoreCitations({
    response: result.response,
    requiredSources: scenario.requiredSources,
    registeredIds,
  });

  const trapDetails = scoreTraps({
    response: result.response,
    traps: scenario.traps ?? [],
  });

  const trapFired = trapDetails.fired.length > 0;
  const answerable = trapFired ? "NO" : citationScore.answerable;
  const confidence = trapFired ? 0 : citationScore.confidence;
  const reason = trapFired
    ? `Trap fired: ${trapDetails.fired.map((t) => `"${t.id}" (${t.reason})`).join("; ")}`
    : citationScore.reason;

  return {
    scenario,
    answerable,
    confidence,
    response: result.response,
    reason,
    citations: citationScore.citations,
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
  const total = results.length;
  const answered = results.filter(
    (r) => r.answerable === "YES" || r.answerable === "PARTIAL",
  ).length;

  const score =
    total > 0
      ? Math.round(
          results.reduce((sum, r) => {
            if (r.answerable === "YES") return sum + r.confidence;
            if (r.answerable === "PARTIAL") return sum + r.confidence * 0.5;
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
