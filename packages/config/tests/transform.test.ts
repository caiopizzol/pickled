import { describe, expect, test } from "bun:test";
import type { PublicConfig } from "../src/public-types.js";
import { compilePublicConfig, validatePublicConfig } from "../src/transform.js";

// A minimal valid public config. Tests clone and mutate it so each case
// changes exactly one thing.
function base(): PublicConfig {
  return {
    product: { name: "pickled", description: "Agent legibility checker" },
    sources: { docs: "https://example.com/llms.txt", readme: "./README.md" },
    agents: {
      quick: { provider: "claude-code", model: "claude-haiku-4-5" },
      api: { provider: "openai", model: "gpt-5.2" },
    },
    access: {
      prior: { source: "none", tools: "none" },
      injected: { source: "docs", tools: "none" },
      web: { source: "none", tools: "web" },
    },
    questions: [
      {
        id: "positioning",
        ask: "what does it do?",
        agents: ["quick"],
        access: ["prior", "injected"],
        checks: { mustMention: ["agent"] },
      },
    ],
  };
}

describe("validatePublicConfig", () => {
  test("accepts the base config", () => {
    expect(() => validatePublicConfig(base())).not.toThrow();
  });

  test("rejects a missing product.name", () => {
    const pub = base();
    // biome-ignore lint/suspicious/noExplicitAny: deliberately malformed
    (pub as any).product = {};
    expect(() => validatePublicConfig(pub)).toThrow(/product\.name/);
  });

  test("rejects empty questions", () => {
    const pub = base();
    pub.questions = [];
    expect(() => validatePublicConfig(pub)).toThrow(/questions/);
  });

  test('rejects a source id named "none"', () => {
    const pub = base();
    pub.sources = { none: "./x.md" };
    expect(() => validatePublicConfig(pub)).toThrow(
      /source id "none" is reserved/,
    );
  });

  test('rejects an access id named "none"', () => {
    const pub = base();
    pub.access.none = { source: "docs", tools: "none" };
    expect(() => validatePublicConfig(pub)).toThrow(
      /access id "none" is reserved/,
    );
  });

  test("rejects an agent missing provider or model", () => {
    const pub = base();
    // biome-ignore lint/suspicious/noExplicitAny: deliberately malformed
    pub.agents.quick = { provider: "claude-code" } as any;
    expect(() => validatePublicConfig(pub)).toThrow(
      /needs a provider and model/,
    );
  });

  test("rejects an unknown provider", () => {
    const pub = base();
    pub.agents.quick = { provider: "mistral", model: "x" };
    expect(() => validatePublicConfig(pub)).toThrow(
      /unknown provider "mistral"/,
    );
  });

  test("rejects access referencing an unknown source", () => {
    const pub = base();
    pub.access.injected = { source: "ghost", tools: "none" };
    expect(() => validatePublicConfig(pub)).toThrow(/unknown source "ghost"/);
  });

  test("rejects an access tools value outside none|web|mcp", () => {
    const pub = base();
    // biome-ignore lint/suspicious/noExplicitAny: deliberately malformed
    pub.access.injected = { source: "docs", tools: "firecrawl" as any };
    expect(() => validatePublicConfig(pub)).toThrow(/tools must be one of/);
  });

  test("rejects tools: mcp without a servers map", () => {
    const pub = base();
    pub.access.mcp = { source: "none", tools: "mcp" };
    expect(() => validatePublicConfig(pub)).toThrow(/requires a 'servers' map/);
  });

  test("rejects servers when tools is not mcp", () => {
    const pub = base();
    pub.access.web = {
      source: "none",
      tools: "web",
      servers: { x: { url: "https://x" } },
    };
    expect(() => validatePublicConfig(pub)).toThrow(
      /declares 'servers' but tools/,
    );
  });

  test("rejects a question missing id or ask", () => {
    const pub = base();
    // biome-ignore lint/suspicious/noExplicitAny: deliberately malformed
    pub.questions[0] = {
      ask: "x",
      agents: ["quick"],
      access: ["prior"],
      checks: { mustMention: ["a"] },
    } as any;
    expect(() => validatePublicConfig(pub)).toThrow(/needs 'id' and 'ask'/);
  });

  test("rejects a question with no agents", () => {
    const pub = base();
    pub.questions[0]!.agents = [];
    expect(() => validatePublicConfig(pub)).toThrow(/needs at least one agent/);
  });

  test("rejects a question referencing an unknown agent", () => {
    const pub = base();
    pub.questions[0]!.agents = ["ghost"];
    expect(() => validatePublicConfig(pub)).toThrow(/unknown agent "ghost"/);
  });

  test("rejects a question with no access", () => {
    const pub = base();
    pub.questions[0]!.access = [];
    expect(() => validatePublicConfig(pub)).toThrow(
      /needs at least one access/,
    );
  });

  test("rejects a question referencing unknown access", () => {
    const pub = base();
    pub.questions[0]!.access = ["ghost"];
    expect(() => validatePublicConfig(pub)).toThrow(/unknown access "ghost"/);
  });

  test("rejects a question with no checks", () => {
    const pub = base();
    pub.questions[0]!.checks = {};
    expect(() => validatePublicConfig(pub)).toThrow(
      /needs at least one of checks/,
    );
  });

  test("rejects an anyOf group without a label or values", () => {
    const pub = base();
    pub.questions[0]!.checks = {
      anyOf: [{ label: "", values: ["x"] }],
    };
    expect(() => validatePublicConfig(pub)).toThrow(
      /anyOf groups need a label/,
    );
  });

  test("accepts a question whose only check is anyOf", () => {
    const pub = base();
    pub.questions[0]!.checks = {
      anyOf: [{ label: "names a provider", values: ["openai", "anthropic"] }],
    };
    expect(() => validatePublicConfig(pub)).not.toThrow();
  });
});

describe("compilePublicConfig", () => {
  test("maps product to tool", () => {
    const c = compilePublicConfig(base());
    expect(c.tool).toEqual({
      name: "pickled",
      description: "Agent legibility checker",
    });
  });

  test("infers target category from provider", () => {
    const c = compilePublicConfig(base());
    expect(c.targets?.quick?.category).toBe("cli");
    expect(c.targets?.quick?.provider).toBe("claude-code");
    expect(c.targets?.api?.category).toBe("api");
    expect(c.targets?.api?.provider).toBe("openai");
  });

  test("passes through optional agent fields", () => {
    const pub = base();
    pub.agents.quick = {
      provider: "claude-code",
      model: "claude-haiku-4-5",
      maxTurns: 5,
    };
    pub.agents.api = {
      provider: "openai",
      model: "gpt-5.2",
      temperature: 0,
      maxTokens: 4096,
    };
    const c = compilePublicConfig(pub);
    expect(c.targets?.quick?.maxTurns).toBe(5);
    expect(c.targets?.api?.temperature).toBe(0);
    expect(c.targets?.api?.maxTokens).toBe(4096);
  });

  test("maps sources to docs.sources (string form)", () => {
    const c = compilePublicConfig(base());
    expect(c.docs?.sources).toEqual({
      docs: "https://example.com/llms.txt",
      readme: "./README.md",
    });
  });

  test("omits docs when no sources are declared", () => {
    const pub = base();
    pub.sources = undefined;
    pub.access = { prior: { source: "none", tools: "none" } };
    pub.questions[0]!.access = ["prior"];
    const c = compilePublicConfig(pub);
    expect(c.docs).toBeUndefined();
  });

  test("tools: none compiles to the shared internal toolset 'none'", () => {
    const c = compilePublicConfig(base());
    expect(c.toolsets?.none).toEqual({});
  });

  test('source: none compiles to the string "none", never null', () => {
    const c = compilePublicConfig(base());
    const pairs = c.scenarios[0]!.matrix?.accessPairs;
    const prior = pairs?.find(
      (p) => p.toolset === "none" && p.source === "none",
    );
    expect(prior).toEqual({
      access: "prior",
      source: "none",
      toolset: "none",
    });
    // Guard: no pair carries a null source for an injected/prior cell.
    expect(pairs?.some((p) => p.source === null)).toBe(false);
  });

  test("tools: web synthesizes a web toolset named after the access", () => {
    const pub = base();
    pub.questions[0]!.access = ["web"];
    pub.questions[0]!.checks = { mustMention: ["agent"] };
    const c = compilePublicConfig(pub);
    expect(c.toolsets?.web).toEqual({ webSearch: true, webFetch: true });
    expect(c.scenarios[0]!.matrix?.accessPairs).toContainEqual({
      access: "web",
      source: "none",
      toolset: "web",
    });
  });

  test("tools: mcp synthesizes an mcp toolset with servers", () => {
    const pub = base();
    pub.access.docs_mcp = {
      source: "docs",
      tools: "mcp",
      servers: {
        mintlify: {
          url: "https://mcp.example.com/mcp",
          headers: { KEY: "v" },
        },
      },
    };
    pub.questions[0]!.access = ["docs_mcp"];
    const c = compilePublicConfig(pub);
    expect(c.toolsets?.docs_mcp?.mcpServers?.mintlify?.url).toBe(
      "https://mcp.example.com/mcp",
    );
    expect(c.toolsets?.docs_mcp?.mcpServers?.mintlify?.type).toBe("http");
    expect(c.toolsets?.docs_mcp?.mcpServers?.mintlify?.headers).toEqual({
      KEY: "v",
    });
    expect(c.scenarios[0]!.matrix?.accessPairs).toContainEqual({
      access: "docs_mcp",
      source: "docs",
      toolset: "docs_mcp",
    });
  });

  test("maps a question to a scenario with interfaces + accessPairs", () => {
    const c = compilePublicConfig(base());
    const s = c.scenarios[0]!;
    expect(s.name).toBe("positioning");
    expect(s.prompt).toBe("what does it do?");
    expect(s.matrix?.interfaces).toEqual(["quick"]);
    expect(s.matrix?.accessPairs).toEqual([
      { access: "prior", source: "none", toolset: "none" },
      { access: "injected", source: "docs", toolset: "none" },
    ]);
  });

  test("maps checks to expected (mustMention/mustNotMention/anyOf)", () => {
    const pub = base();
    pub.questions[0]!.checks = {
      mustMention: ["agent"],
      mustNotMention: ["AI-powered"],
      anyOf: [{ label: "capability", values: ["legible", "context"] }],
    };
    const c = compilePublicConfig(pub);
    expect(c.scenarios[0]!.expected).toEqual({
      includes: ["agent"],
      excludes: ["AI-powered"],
      anyOf: [{ label: "capability", values: ["legible", "context"] }],
    });
  });

  test("passes examples and threshold through", () => {
    const pub = base();
    pub.questions[0]!.examples = { pass: ["good"], fail: ["bad"] };
    pub.threshold = 60;
    const c = compilePublicConfig(pub);
    expect(c.scenarios[0]!.examples).toEqual({ pass: ["good"], fail: ["bad"] });
    expect(c.threshold).toBe(60);
  });
});
