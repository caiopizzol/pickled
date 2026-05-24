import type { Target, TargetCategory } from "@pickled-dev/config";
import OpenAI from "openai";
import { buildCitationPrompt } from "../citation-prompt.js";
import { buildDiscoveryPrompt } from "../discovery-prompt.js";
import type {
  ResponseEntry,
  RunOptions,
  TargetResult,
  TargetRunner,
} from "../types.js";

/**
 * OpenAI Responses API target (v1: no-tool baseline). Sends registered
 * sources as controlled context to the Responses API directly. Distinct
 * from CLI targets: no workspace, no Agent SDK orchestration. The model
 * sees the citation prompt as `instructions`, the scenario prompt as
 * `input`, and is expected to return its answer with a `## Sources`
 * section.
 *
 * Toolset support today: `none` only. The matrix runner's provider gate
 * rejects `web` and `mcp` cells on the `openai` interface; those land
 * in follow-up issues (#12 web_search, #13 remote MCP). Discovery-mode
 * prompt handling is wired here so a future cell that bypasses the gate
 * (or a future toolset gate-lift) gets the right system prompt without
 * an adapter change.
 *
 * Requires `OPENAI_API_KEY` in the environment. The model field is
 * required on the target config; the loader enforces this so silent
 * defaults cannot drift between releases.
 */
export class OpenAIApiTarget implements TargetRunner {
  readonly category: TargetCategory = "api";
  readonly provider = "openai";
  readonly name: string;

  private config: Target;
  private clientFactory: () => OpenAI;

  constructor(name: string, config: Target, clientFactory?: () => OpenAI) {
    this.name = name;
    this.config = config;
    this.clientFactory = clientFactory ?? (() => new OpenAI());
  }

  async run(prompt: string, options: RunOptions): Promise<TargetResult> {
    const { tool, docs, requiredSources, discovery } = options;

    if (!this.config.model) {
      // Defense in depth: the loader rejects API targets without a model,
      // but the runtime should not silently substitute a default if a
      // caller bypasses the loader (e.g. tests, programmatic CheckConfig).
      throw new Error(
        `API target "${this.name}" missing 'model'. API targets must declare an explicit model.`,
      );
    }

    const instructions = discovery
      ? buildDiscoveryPrompt(tool, discovery.sourceHint)
      : buildCitationPrompt(tool, docs, requiredSources);
    const client = this.clientFactory();

    const response = await client.responses.create({
      model: this.config.model,
      instructions,
      input: prompt,
      temperature: this.config.temperature ?? 0,
      max_output_tokens: this.config.maxTokens ?? 4096,
    });

    const responseText =
      typeof response.output_text === "string" ? response.output_text : "";

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
