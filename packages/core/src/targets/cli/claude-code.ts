import type { Options as ClaudeAgentOptions } from "@anthropic-ai/claude-agent-sdk";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { Target, TargetCategory, ToolInfo } from "../../types.js";
import type { RunOptions, TargetResult, TargetRunner } from "../types.js";

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

    // Build system prompt
    const systemPrompt = this.buildSystemPrompt(tool);

    // Merge context settings with target config
    const allowedTools = context?.allowedTools ??
      this.config.allowedTools ?? ["Read", "Glob", "Grep", "Bash"];
    const disallowedTools = context?.disallowedTools ??
      this.config.disallowedTools ?? ["Edit", "Write", "NotebookEdit"];

    const agentOptions: ClaudeAgentOptions = {
      cwd,
      model: this.config.model ?? "claude-sonnet-4-20250514",
      systemPrompt,
      allowedTools,
      disallowedTools,
      permissionMode: this.config.permissionMode ?? "acceptEdits",
      maxTurns: this.config.maxTurns ?? 5,
      mcpServers: (context?.mcpServers ??
        this.config.mcpServers) as ClaudeAgentOptions["mcpServers"],
      settingSources: [],
    };

    let fullResponse = "";

    for await (const message of query({ prompt, options: agentOptions })) {
      // Extract text content from assistant messages
      if (message.type === "assistant") {
        const content = message.message?.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === "text") {
              fullResponse += (block as { type: "text"; text: string }).text;
            }
            // Track tool usage
            if (block.type === "tool_use") {
              const toolBlock = block as { type: "tool_use"; name: string };
              if (!toolsUsed.includes(toolBlock.name)) {
                toolsUsed.push(toolBlock.name);
              }
            }
          }
        }
      }

      // Extract result
      if (message.type === "result") {
        const resultMsg = message as {
          type: "result";
          subtype: string;
          result?: string;
        };
        if (resultMsg.subtype === "success" && resultMsg.result) {
          fullResponse += resultMsg.result;
        }
      }

      // Track tool results for sources
      if (message.type === "tool_result") {
        const toolResult = message as {
          type: "tool_result";
          tool_name?: string;
          content?: unknown;
        };
        // Could extract file paths, URLs from tool results here
        if (
          toolResult.tool_name === "Read" &&
          typeof toolResult.content === "string"
        ) {
          // Extract file path from Read tool results
          const match = toolResult.content.match(/^Reading (.+)/);
          if (match) {
            sources.push(match[1]);
          }
        }
      }
    }

    return {
      response: fullResponse,
      toolsUsed,
      sources,
      metadata: {
        model: this.config.model ?? "claude-sonnet-4-20250514",
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
