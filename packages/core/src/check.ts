import { fetchDocs, getCodebaseSource } from "./sources.js";
import { createTarget, resolveTarget } from "./targets/index.js";
import type {
  CheckConfig,
  CheckReport,
  DocSource,
  Scenario,
  ScenarioResult,
  ToolInfo,
} from "./types.js";
import { parseValidation } from "./validator.js";

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

  for (const scenario of config.scenarios) {
    onProgress?.(`Running: ${scenario.name}`);

    try {
      const result = await runScenario(scenario, tool, config, { onProgress });
      results.push(result);

      const icon =
        result.answerable === "YES"
          ? "✓"
          : result.answerable === "PARTIAL"
            ? "⚠"
            : "✗";
      onProgress?.(`  ${icon} ${result.answerable} (${result.confidence}%)`);
    } catch (error) {
      const errorResult: ScenarioResult = {
        scenario,
        answerable: "NO",
        confidence: 0,
        response: "",
        reason: "Error during validation",
        error: error instanceof Error ? error.message : String(error),
      };
      results.push(errorResult);
      onProgress?.(`  ✗ Error: ${error}`);
    }
  }

  return buildReport(tool, docs, results);
}

/**
 * Run a single scenario against its target
 */
async function runScenario(
  scenario: Scenario,
  tool: ToolInfo,
  config: CheckConfig,
  options: { onProgress?: (msg: string) => void },
): Promise<ScenarioResult> {
  // Resolve target (named reference or default)
  const { name: targetName, config: targetConfig } = resolveTarget(
    scenario.target,
    config.targets,
  );

  // Create target runner
  const target = createTarget(targetName, targetConfig);

  // Run scenario
  const result = await target.run(scenario.prompt, {
    tool,
    cwd: tool.path,
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
    toolsUsed: result.toolsUsed,
    sources: result.sources,
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
