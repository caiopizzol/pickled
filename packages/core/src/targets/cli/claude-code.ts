import type { Options as ClaudeAgentOptions } from "@anthropic-ai/claude-agent-sdk";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type {
  ResolvedDocSource,
  Target,
  TargetCategory,
} from "@pickled-dev/config";
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
    const { tool, cwd, context, docs, requiredSources } = options;
    const toolsUsed: string[] = [];
    const sources: string[] = [];

    const systemPrompt = this.buildCitationPrompt(tool, docs, requiredSources);

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

  private buildCitationPrompt(
    tool: ToolInfo,
    docs: ResolvedDocSource[],
    requiredSources: string[],
  ): string {
    const inventory =
      docs.length > 0
        ? docs.map((d) => `- ${d.id}: ${d.name} (${d.source})`).join("\n")
        : "(no sources provided)";

    const sourcesBlock = docs
      .map((d) => `<source id="${d.id}">\n${d.content.trimEnd()}\n</source>`)
      .join("\n\n");

    const requiredLine =
      requiredSources.length > 0
        ? `The scenario REQUIRES citations from: ${requiredSources.join(", ")}.`
        : "No specific source is required, but every claim must cite a registered source.";

    return `You are answering a question about the tool "${tool.name}": ${tool.description}.

Answer using ONLY information from the provided sources below. Do not draw on general knowledge.

Available sources:
${inventory}

${sourcesBlock}

${requiredLine}

End your response with a "## Sources" section that lists every source you actually used. Use this exact format:

## Sources
- [source-id] short note on what this source contributed
- [other-id] short note

Rules:
- Only cite IDs that appear in the inventory above. Do not invent IDs.
- If you cannot answer from the provided sources, say so explicitly and write an empty "## Sources" section (just the heading, no bullets).
- The "## Sources" heading must be the last heading in your response.`;
  }
}
