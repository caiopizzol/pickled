import Anthropic from "@anthropic-ai/sdk";
import type { Target, TargetCategory } from "@pickled-dev/config";
import { buildCitationPrompt } from "../citation-prompt.js";
import type {
  ResponseEntry,
  RunOptions,
  TargetResult,
  TargetRunner,
} from "../types.js";

/**
 * Anthropic API target. Sends registered sources as controlled context to the
 * Messages API directly. Distinct from the Claude Code CLI target: no tool
 * use, no workspace, no Agent SDK orchestration. The model sees the citation
 * prompt as `system`, the scenario prompt as a single user message, and is
 * expected to return its answer with a `## Sources` section.
 *
 * Requires `ANTHROPIC_API_KEY` in the environment. The model field is required
 * on the target config; the loader enforces this so silent defaults cannot
 * drift between releases.
 *
 * Distinct from chat surfaces (Claude chat, Claude Desktop): those have their
 * own system prompts, tool sets, and routing. API target results are
 * comparable to CLI target results but not identical.
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
    // Lazy factory so tests can inject a mock client without environment setup.
    this.clientFactory = clientFactory ?? (() => new Anthropic());
  }

  async run(prompt: string, options: RunOptions): Promise<TargetResult> {
    const { tool, docs, requiredSources } = options;

    if (!this.config.model) {
      // Defense in depth: the loader rejects API targets without a model, but
      // the runtime should not silently substitute a default if a caller
      // bypasses the loader (e.g., test fixtures, programmatic CheckConfig).
      throw new Error(
        `API target "${this.name}" missing 'model'. API targets must declare an explicit model.`,
      );
    }

    const systemPrompt = buildCitationPrompt(tool, docs, requiredSources);
    const client = this.clientFactory();

    const message = await client.messages.create({
      model: this.config.model,
      max_tokens: this.config.maxTokens ?? 4096,
      temperature: this.config.temperature ?? 0,
      system: systemPrompt,
      messages: [{ role: "user", content: prompt }],
    });

    const responseText = extractText(message.content);

    const allResponses: ResponseEntry[] = responseText
      ? [{ type: "final", text: responseText }]
      : [];

    return {
      response: responseText,
      allResponses,
      toolsUsed: [],
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
