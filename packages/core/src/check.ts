import { query } from "@anthropic-ai/claude-agent-sdk";
import type { Options as ClaudeAgentOptions } from "@anthropic-ai/claude-agent-sdk";
import type { CheckReport, Scenario, ScenarioResult, ToolInfo } from "./types.js";
import { validateScenario } from "./validator.js";

export interface CheckOptions {
  model?: string;
  allowedTools?: string[];
  disallowedTools?: string[];
  permissionMode?: "default" | "acceptEdits" | "bypassPermissions";
  maxTurns?: number;
  mcpServers?: Record<string, unknown>;
  onProgress?: (msg: string) => void;
}

export async function runCheck(
  tool: ToolInfo,
  scenarios: Scenario[],
  options: CheckOptions = {},
): Promise<CheckReport> {
  const { onProgress, ...runnerOptions } = options;
  const results: ScenarioResult[] = [];

  for (const scenario of scenarios) {
    onProgress?.(`Running: ${scenario.name}`);

    try {
      const response = await runScenario(scenario, tool, runnerOptions);
      const passed = validateScenario(response, tool.name);

      results.push({ scenario, passed, response });
      onProgress?.(passed ? `  ✓ Passed` : `  ✗ Failed`);
    } catch (error) {
      results.push({
        scenario,
        passed: false,
        response: "",
        error: error instanceof Error ? error.message : String(error),
      });
      onProgress?.(`  ✗ Error: ${error}`);
    }
  }

  return buildReport(tool, results);
}

async function runScenario(
  scenario: Scenario,
  tool: ToolInfo,
  runnerOptions: Omit<CheckOptions, "onProgress">,
): Promise<string> {
  const systemPrompt = `You are an AI assistant helping a developer.
The developer is working on "${tool.name}": ${tool.description}
Keywords: ${tool.keywords.join(", ")}

Answer naturally. If ${tool.name} is relevant to the question, mention it.`;

  let fullResponse = "";

  // Create env without ANTHROPIC_API_KEY to ensure OAuth is used
  // This prevents inheriting API keys from parent Claude Code sessions
  const cleanEnv = { ...process.env };
  delete cleanEnv.ANTHROPIC_API_KEY;

  const options: ClaudeAgentOptions = {
    cwd: tool.path,
    model: runnerOptions.model ?? "claude-sonnet-4-20250514",
    systemPrompt,
    allowedTools: runnerOptions.allowedTools ?? ["Read", "Glob", "Grep", "Bash"],
    disallowedTools: runnerOptions.disallowedTools ?? ["Edit", "Write", "NotebookEdit"],
    permissionMode: runnerOptions.permissionMode ?? "acceptEdits",
    maxTurns: runnerOptions.maxTurns ?? 5,
    mcpServers: runnerOptions.mcpServers,
    settingSources: [],
  };

  for await (const message of query({ prompt: scenario.prompt, options })) {
    if (message.type === "assistant") {
      const content = message.message?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === "text") {
            fullResponse += (block as { type: "text"; text: string }).text;
          }
        }
      }
    }

    if (message.type === "result") {
      const resultMsg = message as { type: "result"; subtype: string; result?: string };
      if (resultMsg.subtype === "success" && resultMsg.result) {
        fullResponse += resultMsg.result;
      }
    }
  }

  return fullResponse;
}

function buildReport(tool: ToolInfo, results: ScenarioResult[]): CheckReport {
  const total = results.length;
  const passed = results.filter((r) => r.passed).length;

  return {
    tool: {
      name: tool.name,
      description: tool.description,
      path: tool.path,
    },
    scenarios: results,
    summary: {
      total,
      passed,
      failed: total - passed,
      freshness: total > 0 ? Math.round((passed / total) * 100) : 0,
    },
  };
}
