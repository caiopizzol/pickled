import { describe, expect, test } from "bun:test";
import type Anthropic from "@anthropic-ai/sdk";
import type { Target } from "@pickled-dev/config";
import { AnthropicApiTarget } from "../../src/targets/api/anthropic.js";

// Cast through unknown to satisfy the AnthropicApiTarget signature with a
// structural mock. Avoids `any` so biome's noExplicitAny does not fire and
// keeps the warning count clean.
type MockClient = ReturnType<typeof makeMockClient>["client"];
function asAnthropic(client: MockClient): Anthropic {
  return client as unknown as Anthropic;
}

const baseConfig: Target = {
  category: "api",
  provider: "anthropic",
  model: "claude-haiku-4-5",
};

const baseRunOptions = {
  tool: { name: "t", description: "d", path: "/tmp/x" },
  cwd: "/tmp/x",
  docs: [],
  requiredSources: [],
};

interface CapturedCreateCall {
  model: string;
  max_tokens: number;
  temperature?: number;
  system: string;
  messages: Array<{ role: string; content: string }>;
  tools?: Array<{ type: string; name: string }>;
}

type MockContentBlock =
  | { type: "text"; text: string }
  | { type: "server_tool_use"; id: string; name: string; input?: unknown }
  | {
      type: "web_search_tool_result";
      tool_use_id: string;
      content: unknown;
    };

function makeMockClient(response: string | MockContentBlock[]): {
  client: {
    messages: { create: (params: CapturedCreateCall) => Promise<unknown> };
  };
  calls: CapturedCreateCall[];
} {
  const calls: CapturedCreateCall[] = [];
  const content: MockContentBlock[] =
    typeof response === "string"
      ? [{ type: "text", text: response }]
      : response;
  const client = {
    messages: {
      create: async (params: CapturedCreateCall) => {
        calls.push(params);
        return {
          id: "msg_test",
          type: "message",
          role: "assistant",
          model: params.model,
          content,
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 0, output_tokens: 0 },
        };
      },
    },
  };
  return { client, calls };
}

describe("AnthropicApiTarget", () => {
  test("returns the assistant text response", async () => {
    const { client } = makeMockClient("Answer here.\n\n## Sources\n- [readme]");
    const target = new AnthropicApiTarget("anth", baseConfig, () =>
      asAnthropic(client),
    );
    const result = await target.run("How?", baseRunOptions);
    expect(result.response).toBe("Answer here.\n\n## Sources\n- [readme]");
    expect(result.allResponses).toHaveLength(1);
    expect(result.allResponses[0]?.type).toBe("final");
    expect(result.toolsUsed).toEqual([]);
    expect(result.sources).toEqual([]);
  });

  test("metadata reflects the configured model and target name", async () => {
    const { client } = makeMockClient("ok");
    const target = new AnthropicApiTarget(
      "production-anth",
      { ...baseConfig, model: "claude-sonnet-4-5" },
      () => asAnthropic(client),
    );
    const result = await target.run("?", baseRunOptions);
    expect(result.metadata).toEqual({
      model: "claude-sonnet-4-5",
      category: "api",
      provider: "anthropic",
      target: "production-anth",
    });
  });

  test("passes citation prompt as system, user prompt as message", async () => {
    const { client, calls } = makeMockClient("ok");
    const target = new AnthropicApiTarget("anth", baseConfig, () =>
      asAnthropic(client),
    );
    await target.run("How do I install?", baseRunOptions);
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.model).toBe("claude-haiku-4-5");
    expect(call.system).toContain("Answer using ONLY information");
    expect(call.system).toContain("End your response with a");
    expect(call.messages).toEqual([
      { role: "user", content: "How do I install?" },
    ]);
  });

  test("applies temperature and maxTokens from config (defaults: 0 and 4096)", async () => {
    const { client, calls } = makeMockClient("ok");
    const target = new AnthropicApiTarget("anth", baseConfig, () =>
      asAnthropic(client),
    );
    await target.run("?", baseRunOptions);
    expect(calls[0]?.temperature).toBe(0);
    expect(calls[0]?.max_tokens).toBe(4096);
  });

  test("respects explicit temperature and maxTokens", async () => {
    const { client, calls } = makeMockClient("ok");
    const target = new AnthropicApiTarget(
      "anth",
      { ...baseConfig, temperature: 0.5, maxTokens: 2048 },
      () => asAnthropic(client),
    );
    await target.run("?", baseRunOptions);
    expect(calls[0]?.temperature).toBe(0.5);
    expect(calls[0]?.max_tokens).toBe(2048);
  });

  test("throws when model is missing (defense in depth)", async () => {
    // The loader normally rejects this; the runtime guard catches callers that
    // bypass the loader (e.g., programmatic CheckConfig). The runtime guard
    // fires before clientFactory is invoked, so the factory does not need to
    // be supplied.
    const { client } = makeMockClient("(unused)");
    const target = new AnthropicApiTarget(
      "bad",
      { category: "api", provider: "anthropic" },
      () => asAnthropic(client),
    );
    await expect(target.run("?", baseRunOptions)).rejects.toThrow(
      /missing 'model'/,
    );
  });

  test("returns empty response when assistant content has no text blocks", async () => {
    const client = {
      messages: {
        create: async () => ({
          id: "msg_test",
          type: "message",
          role: "assistant",
          model: "claude-haiku-4-5",
          content: [],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 0, output_tokens: 0 },
        }),
      },
    };
    const target = new AnthropicApiTarget("anth", baseConfig, () =>
      asAnthropic(client),
    );
    const result = await target.run("?", baseRunOptions);
    expect(result.response).toBe("");
    expect(result.allResponses).toHaveLength(0);
  });

  test("does not pass tools array when webTools is undefined", async () => {
    const { client, calls } = makeMockClient("ok");
    const target = new AnthropicApiTarget("anth", baseConfig, () =>
      asAnthropic(client),
    );
    await target.run("?", baseRunOptions);
    expect(calls[0]?.tools).toBeUndefined();
  });

  test("webTools.search wires web_search_20250305 into the tools array", async () => {
    const { client, calls } = makeMockClient("ok");
    const target = new AnthropicApiTarget("anth", baseConfig, () =>
      asAnthropic(client),
    );
    await target.run("?", {
      ...baseRunOptions,
      webTools: { search: true },
      discovery: { sourceHint: null },
    });
    expect(calls[0]?.tools).toEqual([
      { type: "web_search_20250305", name: "web_search" },
    ]);
  });

  test("discovery mode swaps citation prompt for discovery prompt", async () => {
    const { client, calls } = makeMockClient("ok");
    const target = new AnthropicApiTarget("anth", baseConfig, () =>
      asAnthropic(client),
    );
    await target.run("How?", {
      ...baseRunOptions,
      webTools: { search: true },
      discovery: { sourceHint: "https://example.com/docs" },
    });
    // Discovery prompt advertises the agent's research mode; citation
    // prompt's "Answer using ONLY information" phrasing is absent.
    expect(calls[0]?.system).not.toContain("Answer using ONLY information");
    expect(calls[0]?.system).toContain("https://example.com/docs");
  });

  test("captures server_tool_use blocks as toolsUsed (provenance signal)", async () => {
    const { client } = makeMockClient([
      { type: "text", text: "Searching..." },
      {
        type: "server_tool_use",
        id: "srvtoolu_1",
        name: "web_search",
        input: { query: "pickled" },
      },
      {
        type: "web_search_tool_result",
        tool_use_id: "srvtoolu_1",
        content: [],
      },
      { type: "text", text: "Pickled is a CLI for agent legibility." },
    ]);
    const target = new AnthropicApiTarget("anth", baseConfig, () =>
      asAnthropic(client),
    );
    const result = await target.run("?", {
      ...baseRunOptions,
      webTools: { search: true },
      discovery: { sourceHint: null },
    });
    expect(result.toolsUsed).toEqual(["web_search"]);
    expect(result.response).toContain("Pickled is a CLI");
  });

  test("multiple server_tool_use blocks of the same name dedupe", async () => {
    const { client } = makeMockClient([
      { type: "server_tool_use", id: "srvtoolu_1", name: "web_search" },
      { type: "server_tool_use", id: "srvtoolu_2", name: "web_search" },
      { type: "text", text: "ok" },
    ]);
    const target = new AnthropicApiTarget("anth", baseConfig, () =>
      asAnthropic(client),
    );
    const result = await target.run("?", baseRunOptions);
    expect(result.toolsUsed).toEqual(["web_search"]);
  });

  test("toolsUsed is empty when response has no server_tool_use blocks", async () => {
    const { client } = makeMockClient("plain answer");
    const target = new AnthropicApiTarget("anth", baseConfig, () =>
      asAnthropic(client),
    );
    const result = await target.run("?", {
      ...baseRunOptions,
      webTools: { search: true },
      discovery: { sourceHint: null },
    });
    // No server_tool_use block in the response means the model answered
    // without searching. The matrix runner's provenance hard-veto reads
    // empty toolsUsed for a web cell and forces NO/0; the adapter itself
    // simply reports what it saw.
    expect(result.toolsUsed).toEqual([]);
  });
});
