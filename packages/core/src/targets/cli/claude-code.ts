import type { Options as ClaudeAgentOptions } from "@anthropic-ai/claude-agent-sdk";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { Target, TargetCategory } from "@pickled-dev/config";
import {
  DEFAULT_ALLOWED_TOOLS,
  DEFAULT_DISALLOWED_TOOLS,
  EDIT_ALLOWED_TOOLS,
} from "@pickled-dev/config";
import { buildSystemPrompt } from "../prompt.js";
import type {
  ResponseEntry,
  RunOptions,
  TargetResult,
  TargetRunner,
} from "../types.js";

/**
 * Build the Claude Agent SDK options for a run. The system prompt comes from
 * the explicit prompt context (no citation fallback). Build cells
 * (`promptContext.kind === "build"`) get the workspace edit profile plus
 * `bypassPermissions`; question cells keep the read-biased defaults. Web/mcp
 * tool scoping arrives via the resolved `Target` (allowedTools/mcpServers, set
 * by cell-runtime) plus `restrictBuiltinTools`.
 */
export function buildAgentOptions(
  config: Target,
  options: RunOptions,
): ClaudeAgentOptions {
  const { tool, cwd, promptContext, restrictBuiltinTools, signal } = options;
  const editMode = promptContext.kind === "build";

  const agentOptions: ClaudeAgentOptions = {
    cwd,
    model: config.model ?? "sonnet",
    systemPrompt: buildSystemPrompt(tool, promptContext),
    allowedTools: editMode
      ? EDIT_ALLOWED_TOOLS
      : (config.allowedTools ?? DEFAULT_ALLOWED_TOOLS),
    disallowedTools: editMode
      ? []
      : (config.disallowedTools ?? DEFAULT_DISALLOWED_TOOLS),
    permissionMode: editMode
      ? "bypassPermissions"
      : (config.permissionMode ?? "acceptEdits"),
    maxTurns: config.maxTurns ?? 10,
    maxThinkingTokens: config.maxThinkingTokens,
    maxBudgetUsd: config.maxBudgetUsd,
    mcpServers: config.mcpServers as ClaudeAgentOptions["mcpServers"],
    settingSources: [],
  };

  // Wire the run's cancellation signal to the SDK's abortController so a
  // wall-clock timeout actually stops the query.
  if (signal) {
    const controller = new AbortController();
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", () => controller.abort());
    agentOptions.abortController = controller;
  }

  // SDK `tools` is what actually restricts built-in availability. Build mode
  // must keep the workspace tools available, composed with any web/mcp scope;
  // question mode uses the runner's exact scope.
  if (editMode) {
    agentOptions.tools = [
      ...new Set([...EDIT_ALLOWED_TOOLS, ...(restrictBuiltinTools ?? [])]),
    ];
  } else if (restrictBuiltinTools !== undefined) {
    agentOptions.tools = restrictBuiltinTools;
  }

  return agentOptions;
}

export class ClaudeCodeTarget implements TargetRunner {
  readonly category: TargetCategory = "cli";
  readonly provider = "claude-code";
  readonly name: string;

  private config: Target;

  constructor(name: string, config: Target) {
    this.name = name;
    this.config = config;
  }

  async run(prompt: string, options: RunOptions): Promise<TargetResult> {
    const agentOptions = buildAgentOptions(this.config, options);
    const toolsUsed: string[] = [];
    const sources: string[] = [];
    const allResponses: ResponseEntry[] = [];
    let lastAssistantText = "";
    let finalResult = "";

    for await (const message of query({ prompt, options: agentOptions })) {
      if (message.type === "assistant") {
        const content = message.message?.content;
        if (Array.isArray(content)) {
          let messageText = "";
          for (const block of content) {
            if (block.type === "text") {
              messageText += (block as { type: "text"; text: string }).text;
            }
            if (block.type === "tool_use") {
              const toolBlock = block as { type: "tool_use"; name: string };
              if (!toolsUsed.includes(toolBlock.name)) {
                toolsUsed.push(toolBlock.name);
              }
            }
          }
          if (messageText) {
            const entryType: ResponseEntry["type"] =
              allResponses.length === 0 ? "initial" : "intermediate";
            allResponses.push({ type: entryType, text: messageText });
            lastAssistantText = messageText;
          }
        }
      }

      if (message.type === "result") {
        const resultMsg = message as {
          type: "result";
          subtype: string;
          result?: string;
        };
        if (resultMsg.result) {
          finalResult = resultMsg.result;
        }
      }
    }

    if (allResponses.length > 0) {
      allResponses[allResponses.length - 1]!.type = "final";
    }

    return {
      response: finalResult || lastAssistantText,
      allResponses,
      toolsUsed,
      sources,
      metadata: {
        model: this.config.model ?? "sonnet",
        category: this.category,
        provider: this.provider,
        target: this.name,
      },
    };
  }
}
