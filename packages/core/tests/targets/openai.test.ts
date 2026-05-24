import { describe, expect, test } from "bun:test";
import type { Target } from "@pickled-dev/config";
import type OpenAI from "openai";
import { OpenAIApiTarget } from "../../src/targets/api/openai.js";

// Cast through unknown to satisfy the OpenAIApiTarget signature with a
// structural mock. Avoids `any` so biome's noExplicitAny does not fire and
// keeps the warning count clean.
type MockClient = ReturnType<typeof makeMockClient>["client"];
function asOpenAI(client: MockClient): OpenAI {
  return client as unknown as OpenAI;
}

const baseConfig: Target = {
  category: "api",
  provider: "openai",
  model: "gpt-5.2",
};

const baseRunOptions = {
  tool: { name: "t", description: "d", path: "/tmp/x" },
  cwd: "/tmp/x",
  docs: [],
  requiredSources: [],
};

interface CapturedCreateCall {
  model: string;
  instructions: string;
  input: string;
  temperature?: number;
  max_output_tokens?: number;
}

function makeMockClient(output: string): {
  client: {
    responses: {
      create: (params: CapturedCreateCall) => Promise<unknown>;
    };
  };
  calls: CapturedCreateCall[];
} {
  const calls: CapturedCreateCall[] = [];
  const client = {
    responses: {
      create: async (params: CapturedCreateCall) => {
        calls.push(params);
        return {
          id: "resp_test",
          object: "response",
          created_at: 0,
          model: params.model,
          output_text: output,
          output: [],
          error: null,
          incomplete_details: null,
        };
      },
    },
  };
  return { client, calls };
}

describe("OpenAIApiTarget", () => {
  test("returns the assistant text response", async () => {
    const { client } = makeMockClient("Answer here.\n\n## Sources\n- [readme]");
    const target = new OpenAIApiTarget("oai", baseConfig, () =>
      asOpenAI(client),
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
    const target = new OpenAIApiTarget(
      "production-oai",
      { ...baseConfig, model: "gpt-5.4" },
      () => asOpenAI(client),
    );
    const result = await target.run("?", baseRunOptions);
    expect(result.metadata).toEqual({
      model: "gpt-5.4",
      category: "api",
      provider: "openai",
      target: "production-oai",
    });
  });

  test("passes citation prompt as instructions, user prompt as input", async () => {
    const { client, calls } = makeMockClient("ok");
    const target = new OpenAIApiTarget("oai", baseConfig, () =>
      asOpenAI(client),
    );
    await target.run("How do I install?", baseRunOptions);
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.model).toBe("gpt-5.2");
    expect(call.instructions).toContain("Answer using ONLY information");
    expect(call.instructions).toContain("End your response with a");
    expect(call.input).toBe("How do I install?");
  });

  test("applies temperature and maxTokens defaults (0 and 4096)", async () => {
    const { client, calls } = makeMockClient("ok");
    const target = new OpenAIApiTarget("oai", baseConfig, () =>
      asOpenAI(client),
    );
    await target.run("?", baseRunOptions);
    expect(calls[0]?.temperature).toBe(0);
    expect(calls[0]?.max_output_tokens).toBe(4096);
  });

  test("respects explicit temperature and maxTokens from config", async () => {
    const { client, calls } = makeMockClient("ok");
    const target = new OpenAIApiTarget(
      "oai",
      { ...baseConfig, temperature: 0.5, maxTokens: 2048 },
      () => asOpenAI(client),
    );
    await target.run("?", baseRunOptions);
    expect(calls[0]?.temperature).toBe(0.5);
    expect(calls[0]?.max_output_tokens).toBe(2048);
  });

  test("throws when model is missing (defense in depth)", async () => {
    const { client } = makeMockClient("(unused)");
    const target = new OpenAIApiTarget(
      "bad",
      { category: "api", provider: "openai" },
      () => asOpenAI(client),
    );
    await expect(target.run("?", baseRunOptions)).rejects.toThrow(
      /missing 'model'/,
    );
  });

  test("returns empty response when output_text is empty", async () => {
    const { client } = makeMockClient("");
    const target = new OpenAIApiTarget("oai", baseConfig, () =>
      asOpenAI(client),
    );
    const result = await target.run("?", baseRunOptions);
    expect(result.response).toBe("");
    expect(result.allResponses).toHaveLength(0);
  });

  test("discovery mode swaps citation prompt for discovery prompt", async () => {
    const { client, calls } = makeMockClient("ok");
    const target = new OpenAIApiTarget("oai", baseConfig, () =>
      asOpenAI(client),
    );
    await target.run("How?", {
      ...baseRunOptions,
      discovery: { sourceHint: "https://example.com/docs" },
    });
    expect(calls[0]?.instructions).not.toContain(
      "Answer using ONLY information",
    );
    expect(calls[0]?.instructions).toContain("https://example.com/docs");
  });
});
