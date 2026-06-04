import Anthropic from "@anthropic-ai/sdk";
import type { Target, TargetCategory } from "@pickled-dev/config";
import { buildSystemPrompt } from "../prompt.js";
import type {
  ResponseEntry,
  RunOptions,
  TargetResult,
  TargetRunner,
} from "../types.js";

/**
 * Anthropic API target. Answers via the Messages API directly: no client
 * tools, no workspace, no Agent SDK orchestration. The system prompt comes
 * from the run's prompt context (memory / inject / web discovery); there is no
 * `## Sources` citation contract. For `web` cells (`options.webTools.search`)
 * the target passes the server-side `web_search` tool to `messages.create`;
 * `server_tool_use` blocks are reported as `toolsUsed` so the provenance veto
 * fires the same way as for client-tool cells. `webFetch` has no Anthropic API
 * equivalent.
 *
 * Requires `ANTHROPIC_API_KEY`. The model field is required (the loader enforces
 * it) so silent defaults cannot drift between releases.
 */
export class AnthropicApiTarget implements TargetRunner {
  readonly category: TargetCategory = "api";
  readonly provider = "anthropic";
  readonly name: string;

  private config: Target;
  private clientFactory: () => Anthropic;

  constructor(name: string, config: Target, clientFactory?: () => Anthropic) {
    this.name = name;
    this.config = config;
    this.clientFactory = clientFactory ?? (() => new Anthropic());
  }

  async run(prompt: string, options: RunOptions): Promise<TargetResult> {
    const { tool, promptContext, webTools } = options;

    if (!this.config.model) {
      // Defense in depth: the loader rejects API targets without a model, but
      // the runtime should not silently substitute a default if a caller
      // bypasses the loader (e.g., test fixtures, programmatic CheckConfig).
      throw new Error(
        `API target "${this.name}" missing 'model'. API targets must declare an explicit model.`,
      );
    }

    const systemPrompt = buildSystemPrompt(tool, promptContext);
    const client = this.clientFactory();

    // SDK 0.40 typings predate the `web_search_20250305` server-tool entry,
    // so we build the tool array as a plain object and cast at the SDK
    // boundary. The HTTP API accepts the shape regardless of SDK version.
    const tools = webTools?.search
      ? [{ type: "web_search_20250305", name: "web_search" }]
      : undefined;

    const message = await client.messages.create({
      model: this.config.model,
      max_tokens: this.config.maxTokens ?? 4096,
      temperature: this.config.temperature ?? 0,
      system: systemPrompt,
      messages: [{ role: "user", content: prompt }],
      ...(tools ? { tools: tools as unknown as never } : {}),
    });

    const responseText = extractText(message.content);
    const toolsUsed = extractServerToolUse(message.content);

    const allResponses: ResponseEntry[] = responseText
      ? [{ type: "final", text: responseText }]
      : [];

    return {
      response: responseText,
      allResponses,
      toolsUsed,
      sources: [],
      metadata: {
        model: this.config.model,
        category: this.category,
        provider: this.provider,
        target: this.name,
      },
    };
  }
}

interface MessageContentBlock {
  type: string;
  text?: string;
  name?: string;
}

function extractText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content as MessageContentBlock[]) {
    if (block.type === "text" && typeof block.text === "string") {
      parts.push(block.text);
    }
  }
  return parts.join("");
}

function extractServerToolUse(content: unknown): string[] {
  if (!Array.isArray(content)) return [];
  const seen = new Set<string>();
  for (const block of content as MessageContentBlock[]) {
    if (block.type === "server_tool_use" && typeof block.name === "string") {
      seen.add(block.name);
    }
  }
  return Array.from(seen);
}
