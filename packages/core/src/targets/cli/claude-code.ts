import type { Options as ClaudeAgentOptions } from "@anthropic-ai/claude-agent-sdk";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { Target, TargetCategory } from "@pickled-dev/config";
import {
  DEFAULT_ALLOWED_TOOLS,
  DEFAULT_DISALLOWED_TOOLS,
} from "@pickled-dev/config";
import type { ToolInfo } from "../../types.js";
import type {
  ResponseEntry,
  RunOptions,
  TargetResult,
  TargetRunner,
} from "../types.js";

/**
 * Claude Code target - uses the Claude Agent SDK to run prompts
 */
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
    const { tool, cwd, context } = options;
    const toolsUsed: string[] = [];
    const sources: string[] = [];

    const systemPrompt =
      this.config.systemPrompt ?? this.buildSystemPrompt(tool);

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

    // Mark last response as final
    if (allResponses.length > 0) {
      allResponses[allResponses.length - 1].type = "final";
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

  private buildSystemPrompt(tool: ToolInfo): string {
    return `You are helping a developer understand how to use "${tool.name}": ${tool.description}

Your task is to answer questions about this tool accurately based on the available documentation.

You have access to read the codebase to find documentation, examples, and implementation details.
Look for README files, doc comments, examples directories, and source code.

After answering, provide a structured assessment in JSON format:
\`\`\`json
{
  "answerable": "YES" | "PARTIAL" | "NO",
  "confidence": 0-100,
  "reason": "Brief explanation of your assessment",
  "missing": ["List of missing documentation if applicable"] or null
}
\`\`\`

- YES: The documentation fully answers the question
- PARTIAL: Some information is available but incomplete
- NO: Cannot find relevant documentation`;
  }
}
