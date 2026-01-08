import type { CheckConfig, DocSource, Scenario } from "@pickled-dev/config";
import { fetchDocs, getCodebaseSource } from "./sources.js";
import {
  createTarget,
  resolveContext,
  resolveTarget,
} from "./targets/index.js";
import type { CheckReport, ScenarioResult, ToolInfo } from "./types.js";
import { parseValidation } from "./validator.js";

/**
 * Expanded scenario with resolved target and context
 */
interface ExpandedScenario {
  scenario: Scenario;
  targetName: string;
  contextName: string;
}

/**
 * Expand scenarios into matrix of target × context combinations
 */
function expandMatrix(config: CheckConfig): ExpandedScenario[] {
  const expanded: ExpandedScenario[] = [];

  // Get matrix dimensions (or defaults)
  const matrixTargets = config.matrix?.target ?? ["default"];
  const matrixContexts = config.matrix?.context ?? ["default"];

  for (const scenario of config.scenarios) {
    // Per-scenario overrides take precedence over matrix
    const targets = scenario.target ? [scenario.target] : matrixTargets;
    const contexts = scenario.context ? [scenario.context] : matrixContexts;

    // Cartesian product: target × context
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
}

/**
 * Run check with config format (scenarios + targets)
 */
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

  // Load docs if specified
  let docs: DocSource | undefined;
  if (config.docs?.source) {
    onProgress?.("Loading documentation...");
    try {
      docs = await fetchDocs(config.docs.source);
      onProgress?.(`  Loaded: ${docs.name}`);
    } catch (error) {
      onProgress?.(
        `  Warning: ${error instanceof Error ? error.message : error}`,
      );
      docs = getCodebaseSource(tool.path);
    }
  }

  onProgress?.("");

  // Expand matrix: scenarios × targets × contexts
  const expanded = expandMatrix(config);

  // Track current scenario for grouping output
  let currentScenario = "";

  for (const { scenario, targetName, contextName } of expanded) {
    const label = formatRunLabel(targetName, contextName);

    // Print scenario name only when it changes
    if (scenario.name !== currentScenario) {
      if (currentScenario) onProgress?.(""); // blank line between scenarios
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
        { onProgress },
      );
      results.push(result);

      // Format: [target/context] padded + icon + status
      const labelPadded = label ? label.padEnd(18) : "";
      const { icon, status } = formatResultStatus(result);
      onProgress?.(
        `  ${labelPadded} ${icon} ${status} (${result.confidence}%)`,
      );
    } catch (error) {
      const errorResult: ScenarioResult = {
        scenario,
        answerable: "NO",
        confidence: 0,
        response: "",
        reason: "Error during validation",
        error: error instanceof Error ? error.message : String(error),
        target: {
          target: targetName,
          category: "cli",
          provider: "claude-code",
          model: "unknown",
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

/**
 * Format label for run progress output
 */
function formatRunLabel(targetName: string, contextName: string): string {
  if (targetName === "default" && contextName === "default") {
    return "";
  }
  if (contextName === "default") {
    return `[${targetName}]`;
  }
  return `[${targetName}/${contextName}]`;
}

/**
 * Format result status with icon and label
 */
function formatResultStatus(result: ScenarioResult): {
  icon: string;
  status: string;
} {
  if (result.error) {
    return { icon: "✗", status: "Error" };
  }

  const confidence = result.confidence;

  if (result.answerable === "YES") {
    if (confidence >= 90) {
      return { icon: "✓", status: "Well preserved" };
    }
    return { icon: "✓", status: "Fresh" };
  }

  if (result.answerable === "PARTIAL") {
    return { icon: "⚠", status: "Going stale" };
  }

  return { icon: "✗", status: "Gone sour" };
}

/**
 * Run a single scenario against its target with context
 */
async function runScenario(
  scenario: Scenario,
  targetName: string,
  contextName: string,
  tool: ToolInfo,
  config: CheckConfig,
  options: { onProgress?: (msg: string) => void },
): Promise<ScenarioResult> {
  // Resolve target and context
  const { config: targetConfig } = resolveTarget(targetName, config.targets);
  const { config: contextConfig } = resolveContext(
    contextName,
    config.contexts,
  );

  // Create target runner
  const target = createTarget(targetName, targetConfig);

  // Run scenario with context
  const result = await target.run(scenario.prompt, {
    tool,
    cwd: tool.path,
    context: contextConfig,
    onProgress: options.onProgress,
  });

  // Parse validation from response
  const validation = parseValidation(result.response);

  return {
    scenario,
    answerable: validation.answerable,
    confidence: validation.confidence,
    response: result.response,
    reason: validation.reason,
    missing: validation.missing,
    target: result.metadata,
    context: { name: contextName },
    toolsUsed: result.toolsUsed,
    sources: result.sources,
    allResponses: result.allResponses,
  };
}

/**
 * Build the final report
 */
function buildReport(
  tool: ToolInfo,
  docs: DocSource | undefined,
  results: ScenarioResult[],
): CheckReport {
  const total = results.length;
  const answered = results.filter(
    (r) => r.answerable === "YES" || r.answerable === "PARTIAL",
  ).length;

  // Calculate score based on confidence-weighted results
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
    tool: {
      name: tool.name,
      description: tool.description,
      path: tool.path,
    },
    docs: docs
      ? {
          source: docs.name,
          type: docs.type,
        }
      : undefined,
    scenarios: results,
    summary: {
      total,
      answered,
      unanswered: total - answered,
      score,
    },
  };
}
