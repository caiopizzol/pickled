import type {
  McpServerConfig,
  Target,
  TargetCategory,
} from "@pickled-dev/config";
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
 * Toolset support today: `none`, `web`, and `mcp`.
 *
 * - `web` cells (`options.webTools.search`): passes the server-side
 *   `web_search` tool to `responses.create` and switches to the
 *   discovery prompt. Provenance: `web_search_call` items in
 *   `response.output`, normalized to `toolsUsed: ["web_search"]`.
 * - `mcp` cells (`options.mcpTools.servers`): passes a hosted-MCP tool
 *   entry per declared server (`server_label` = the map key, so the
 *   matrix runner's `mcp__<server>__*` provenance matcher works
 *   uniformly). Approval prompts are bypassed (`require_approval:
 *   "never"`) because pickled runs are non-interactive. Provenance:
 *   `mcp_call` items in `response.output`, normalized to
 *   `mcp__<server_label>__<tool_name>` (same shape the Claude Code
 *   adapter emits for its MCP cells).
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
    const { tool, docs, requiredSources, discovery, webTools, mcpTools } =
      options;

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

    const requestTools: Array<Record<string, unknown>> = [];
    if (webTools?.search) {
      requestTools.push({ type: "web_search" });
    }
    if (mcpTools?.servers) {
      for (const [serverLabel, server] of Object.entries(mcpTools.servers)) {
        requestTools.push(buildMcpToolEntry(serverLabel, server));
      }
    }
    const tools = requestTools.length > 0 ? requestTools : undefined;

    const response = await client.responses.create({
      model: this.config.model,
      instructions,
      input: prompt,
      temperature: this.config.temperature ?? 0,
      max_output_tokens: this.config.maxTokens ?? 4096,
      ...(tools ? { tools: tools as unknown as never } : {}),
    });

    const responseText =
      typeof response.output_text === "string" ? response.output_text : "";
    const toolsUsed = extractToolsUsed(response.output);

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

function buildMcpToolEntry(
  serverLabel: string,
  server: McpServerConfig,
): Record<string, unknown> {
  if (!server.url) {
    // OpenAI hosted MCP requires a server_url (or a connector_id we do
    // not currently support). A pickled mcpServers entry with
    // stdio/command/args has no URL to wire; surface a clear runtime
    // error rather than silently send an invalid tool entry.
    throw new Error(
      `MCP server "${serverLabel}" has no url; the OpenAI hosted-MCP tool requires server_url. Stdio MCP transports are not reachable from the OpenAI API.`,
    );
  }
  const entry: Record<string, unknown> = {
    type: "mcp",
    server_label: serverLabel,
    server_url: server.url,
    // Pickled runs are non-interactive; approval prompts would deadlock
    // the cell. The user is opting in to a third-party MCP server via
    // pickled.yml; setting `never` is the honest behavior for a CI
    // runner.
    require_approval: "never",
  };
  if (server.headers && Object.keys(server.headers).length > 0) {
    entry.headers = server.headers;
  }
  return entry;
}

interface OutputItem {
  type?: string;
  name?: string;
  server_label?: string;
}

function extractToolsUsed(output: unknown): string[] {
  if (!Array.isArray(output)) return [];
  const seen = new Set<string>();
  for (const item of output as OutputItem[]) {
    if (item?.type === "web_search_call") {
      // Normalize to the same provenance string the Anthropic adapter
      // emits (`web_search`) so the matrix runner's matcher stays
      // provider-agnostic.
      seen.add("web_search");
    } else if (
      item?.type === "mcp_call" &&
      typeof item.server_label === "string" &&
      typeof item.name === "string"
    ) {
      // Normalize to `mcp__<server_label>__<tool_name>` (same shape the
      // Claude Agent SDK emits) so the runner's `mcp__<server>__*`
      // prefix matcher works uniformly across providers.
      seen.add(`mcp__${item.server_label}__${item.name}`);
    }
  }
  return Array.from(seen);
}
