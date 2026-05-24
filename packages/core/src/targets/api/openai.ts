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
 * OpenAI Responses API target. Sends registered sources as controlled
 * context to the Responses API directly. Distinct from CLI targets: no
 * workspace, no Agent SDK orchestration. The model sees the citation
 * prompt as `instructions`, the scenario prompt as `input`, and is
 * expected to return its answer with a `## Sources` section.
 *
 * For matrix `web` cells (`options.webTools.search`), the target passes
 * the server-side `web_search` tool to `responses.create` and switches
 * to the discovery prompt (no injected source). Web tool invocations
 * are extracted from `response.output` items of `type:
 * 'web_search_call'` and normalized into `toolsUsed: ["web_search"]` so
 * the matrix runner's tool-use provenance hard-veto fires the same way
 * it does on Claude Code and the Anthropic API target.
 *
 * Toolset support today: `none` and `web`. Remote MCP lands in a
 * follow-up (#13). Currently uses the canonical `web_search` tool type
 * (not the dated `web_search_2025_08_26` variant).
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
    const { tool, docs, requiredSources, discovery, webTools } = options;

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

    const tools = webTools?.search
      ? [{ type: "web_search" as const }]
      : undefined;

    const response = await client.responses.create({
      model: this.config.model,
      instructions,
      input: prompt,
      temperature: this.config.temperature ?? 0,
      max_output_tokens: this.config.maxTokens ?? 4096,
      ...(tools ? { tools } : {}),
    });

    const responseText =
      typeof response.output_text === "string" ? response.output_text : "";
    const toolsUsed = extractWebSearchCalls(response.output);

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

interface OutputItem {
  type?: string;
}

function extractWebSearchCalls(output: unknown): string[] {
  if (!Array.isArray(output)) return [];
  let saw = false;
  for (const item of output as OutputItem[]) {
    if (item?.type === "web_search_call") {
      saw = true;
      break;
    }
  }
  // Normalize to the same provenance string the Anthropic adapter emits
  // (`web_search`) so the matrix runner's matcher logic stays
  // provider-agnostic.
  return saw ? ["web_search"] : [];
}
