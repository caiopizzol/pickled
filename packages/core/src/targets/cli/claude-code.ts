import type { Options as ClaudeAgentOptions } from "@anthropic-ai/claude-agent-sdk";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { Target, TargetCategory } from "@pickled-dev/config";
import {
  DEFAULT_ALLOWED_TOOLS,
  DEFAULT_DISALLOWED_TOOLS,
} from "@pickled-dev/config";
import { buildCitationPrompt } from "../citation-prompt.js";
import { buildDiscoveryPrompt } from "../discovery-prompt.js";
import type {
  ResponseEntry,
  RunOptions,
  TargetResult,
  TargetRunner,
} from "../types.js";

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
    const {
      tool,
      cwd,
      context,
      docs,
      requiredSources,
      discovery,
      restrictBuiltinTools,
    } = options;
    const toolsUsed: string[] = [];
    const sources: string[] = [];

    // Discovery-mode cells (matrix runner sets options.discovery) get a
    // different system prompt: no injected sources, agent uses its tools
    // to research, optional canonical-source hint. Otherwise build the
    // standard citation prompt that injects docs and demands a Sources block.
    const systemPrompt = discovery
      ? buildDiscoveryPrompt(tool, discovery.sourceHint)
      : buildCitationPrompt(tool, docs, requiredSources);

    const agentOptions: ClaudeAgentOptions = {
      cwd,
      model: this.config.model ?? "sonnet",
      systemPrompt,
      allowedTools:
        context?.allowedTools ??
        this.config.allowedTools ??
        DEFAULT_ALLOWED_TOOLS,
      disallowedTools:
        context?.disallowedTools ??
        this.config.disallowedTools ??
        DEFAULT_DISALLOWED_TOOLS,
      permissionMode: this.config.permissionMode ?? "acceptEdits",
      maxTurns: this.config.maxTurns ?? 10,
      maxThinkingTokens: this.config.maxThinkingTokens,
      maxBudgetUsd: this.config.maxBudgetUsd,
      mcpServers: (context?.mcpServers ??
        this.config.mcpServers) as ClaudeAgentOptions["mcpServers"],
      settingSources: [],
    };

    // SDK `tools` controls which built-in tools are available; without
    // restricting it, allowedTools is just an auto-permission list and the
    // agent can still call any built-in (Read/Bash/Glob), bypassing the
    // configured tool path. Matrix runner sets restrictBuiltinTools for
    // non-none cells. Empty array = no built-ins (MCP cells, where the
    // tools come from mcpServers). Non-empty = scope to those built-ins
    // (web cells: WebSearch/WebFetch).
    if (restrictBuiltinTools !== undefined) {
      agentOptions.tools = restrictBuiltinTools;
    }

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
