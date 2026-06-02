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
    tasks: [
      {
        id: "positioning",
        prompt: "what does it do?",
        agents: ["quick"],
        access: ["prior", "injected"],
        checks: { mustMention: ["agent"] },
      },
    ],
  };
}

// A minimal valid build task on an edit-capable agent.
function buildTask(): PublicConfig["tasks"][number] {
  return {
    id: "toolbar",
    prompt: "Add a toolbar.",
    kind: "build",
    agents: ["quick"],
    access: ["injected"],
    workspace: { path: "./fixtures/app", setup: ["bun install"] },
    verify: ["bun test"],
    trials: 3,
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

  test("rejects empty tasks", () => {
    const pub = base();
    pub.tasks = [];
    expect(() => validatePublicConfig(pub)).toThrow(/'tasks' must be/);
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

  test("rejects a task missing id or prompt", () => {
    const pub = base();
    // biome-ignore lint/suspicious/noExplicitAny: deliberately malformed
    pub.tasks[0] = {
      prompt: "x",
      agents: ["quick"],
      access: ["prior"],
      checks: { mustMention: ["a"] },
    } as any;
    delete (pub.tasks[0] as { prompt?: string }).prompt;
    expect(() => validatePublicConfig(pub)).toThrow(/needs 'id' and 'prompt'/);
  });

  test("rejects a task with no agents", () => {
    const pub = base();
    pub.tasks[0]!.agents = [];
    expect(() => validatePublicConfig(pub)).toThrow(/needs at least one agent/);
  });

  test("rejects a task referencing an unknown agent", () => {
    const pub = base();
    pub.tasks[0]!.agents = ["ghost"];
    expect(() => validatePublicConfig(pub)).toThrow(/unknown agent "ghost"/);
  });

  test("rejects a task with no access", () => {
    const pub = base();
    pub.tasks[0]!.access = [];
    expect(() => validatePublicConfig(pub)).toThrow(
      /needs at least one access/,
    );
  });

  test("rejects a task referencing unknown access", () => {
    const pub = base();
    pub.tasks[0]!.access = ["ghost"];
    expect(() => validatePublicConfig(pub)).toThrow(/unknown access "ghost"/);
  });

  test("rejects an answer task with no checks", () => {
    const pub = base();
    pub.tasks[0]!.checks = {};
    expect(() => validatePublicConfig(pub)).toThrow(
      /needs at least one of checks/,
    );
  });

  test("rejects a mustMentionOneOf group without a label or values", () => {
    const pub = base();
    pub.tasks[0]!.checks = {
      mustMentionOneOf: [{ label: "", values: ["x"] }],
    };
    expect(() => validatePublicConfig(pub)).toThrow(
      /mustMentionOneOf groups need a label/,
    );
  });

  test("accepts a task whose only check is mustMentionOneOf", () => {
    const pub = base();
    pub.tasks[0]!.checks = {
      mustMentionOneOf: [
        { label: "names a provider", values: ["openai", "anthropic"] },
      ],
    };
    expect(() => validatePublicConfig(pub)).not.toThrow();
  });
});

describe("validatePublicConfig - migration errors", () => {
  test("rejects the old top-level 'questions' key with a rename hint", () => {
    const pub = base();
    // biome-ignore lint/suspicious/noExplicitAny: old-schema config
    (pub as any).questions = (pub as any).tasks;
    // biome-ignore lint/suspicious/noExplicitAny: old-schema config
    delete (pub as any).tasks;
    expect(() => validatePublicConfig(pub)).toThrow(
      /"questions" was renamed to "tasks"/,
    );
  });

  test("rejects a task using the old 'ask' field with a rename hint", () => {
    const pub = base();
    // biome-ignore lint/suspicious/noExplicitAny: old-schema task
    (pub.tasks[0] as any).ask = "what does it do?";
    // biome-ignore lint/suspicious/noExplicitAny: old-schema task
    delete (pub.tasks[0] as any).prompt;
    expect(() => validatePublicConfig(pub)).toThrow(
      /uses "ask"; it was renamed to "prompt"/,
    );
  });
});

describe("validatePublicConfig - answer/build separation", () => {
  test("accepts a valid build task", () => {
    const pub = base();
    pub.tasks = [buildTask()];
    expect(() => validatePublicConfig(pub)).not.toThrow();
  });

  test("kind defaults to answer when omitted", () => {
    const pub = base();
    expect(pub.tasks[0]!.kind).toBeUndefined();
    expect(() => validatePublicConfig(pub)).not.toThrow();
  });

  test("rejects an unknown kind", () => {
    const pub = base();
    // biome-ignore lint/suspicious/noExplicitAny: deliberately malformed
    pub.tasks[0]!.kind = "verify" as any;
    expect(() => validatePublicConfig(pub)).toThrow(/unknown kind "verify"/);
  });

  test("rejects build-only fields without kind: build (no shape inference)", () => {
    const pub = base();
    pub.tasks[0]!.verify = ["bun test"];
    expect(() => validatePublicConfig(pub)).toThrow(
      /build-only fields .* but kind is not "build"/,
    );
  });

  test("rejects checks on a build task", () => {
    const pub = base();
    const t = buildTask();
    t.checks = { mustMention: ["x"] };
    pub.tasks = [t];
    expect(() => validatePublicConfig(pub)).toThrow(/cannot declare checks/);
  });

  test("rejects examples on a build task", () => {
    const pub = base();
    const t = buildTask();
    t.examples = { pass: ["x"] };
    pub.tasks = [t];
    expect(() => validatePublicConfig(pub)).toThrow(/cannot declare examples/);
  });

  test("rejects a build task with no workspace.path", () => {
    const pub = base();
    const t = buildTask();
    // biome-ignore lint/suspicious/noExplicitAny: deliberately malformed
    t.workspace = {} as any;
    pub.tasks = [t];
    expect(() => validatePublicConfig(pub)).toThrow(
      /needs a non-empty workspace\.path/,
    );
  });

  test("rejects a build task with no verify command", () => {
    const pub = base();
    const t = buildTask();
    t.verify = [];
    pub.tasks = [t];
    expect(() => validatePublicConfig(pub)).toThrow(
      /needs at least one non-empty verify command/,
    );
  });

  test("rejects non-integer trials", () => {
    const pub = base();
    const t = buildTask();
    t.trials = 0;
    pub.tasks = [t];
    expect(() => validatePublicConfig(pub)).toThrow(
      /trials must be a positive integer/,
    );
  });

  test("rejects a build task on a non-edit-capable (API) agent", () => {
    const pub = base();
    const t = buildTask();
    t.agents = ["api"]; // openai -> api category, not edit-capable
    pub.tasks = [t];
    expect(() => validatePublicConfig(pub)).toThrow(
      /cannot run build tasks; build requires an edit-capable CLI agent/,
    );
  });

  test("rejects a non-string workspace.path", () => {
    const pub = base();
    const t = buildTask();
    // biome-ignore lint/suspicious/noExplicitAny: deliberately malformed
    t.workspace = { path: 123 as any };
    pub.tasks = [t];
    expect(() => validatePublicConfig(pub)).toThrow(
      /needs a non-empty workspace\.path/,
    );
  });

  test("rejects a non-string workspace.setup entry", () => {
    const pub = base();
    const t = buildTask();
    // biome-ignore lint/suspicious/noExplicitAny: deliberately malformed
    t.workspace = { path: "./x", setup: [123 as any] };
    pub.tasks = [t];
    expect(() => validatePublicConfig(pub)).toThrow(
      /workspace\.setup must be a list of non-empty shell command strings/,
    );
  });

  test("rejects a non-string verify entry", () => {
    const pub = base();
    const t = buildTask();
    // biome-ignore lint/suspicious/noExplicitAny: deliberately malformed
    t.verify = [123 as any];
    pub.tasks = [t];
    expect(() => validatePublicConfig(pub)).toThrow(
      /needs at least one non-empty verify command/,
    );
  });

  test("rejects an empty-string verify entry", () => {
    const pub = base();
    const t = buildTask();
    t.verify = [""];
    pub.tasks = [t];
    expect(() => validatePublicConfig(pub)).toThrow(
      /needs at least one non-empty verify command/,
    );
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
    pub.tasks[0]!.access = ["prior"];
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
    expect(pairs?.some((p) => p.source === null)).toBe(false);
  });

  test("tools: web synthesizes a web toolset named after the access", () => {
    const pub = base();
    pub.tasks[0]!.access = ["web"];
    pub.tasks[0]!.checks = { mustMention: ["agent"] };
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
    pub.tasks[0]!.access = ["docs_mcp"];
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

  test("maps an answer task to a scenario with interfaces + accessPairs", () => {
    const c = compilePublicConfig(base());
    const s = c.scenarios[0]!;
    expect(s.name).toBe("positioning");
    expect(s.prompt).toBe("what does it do?");
    expect(s.kind).toBeUndefined();
    expect(s.matrix?.interfaces).toEqual(["quick"]);
    expect(s.matrix?.accessPairs).toEqual([
      { access: "prior", source: "none", toolset: "none" },
      { access: "injected", source: "docs", toolset: "none" },
    ]);
  });

  test("maps checks to expected (mustMention/mustMentionOneOf/mustNotMention)", () => {
    const pub = base();
    pub.tasks[0]!.checks = {
      mustMention: ["agent"],
      mustNotMention: ["AI-powered"],
      mustMentionOneOf: [
        { label: "capability", values: ["legible", "context"] },
      ],
    };
    const c = compilePublicConfig(pub);
    expect(c.scenarios[0]!.expected).toEqual({
      includes: ["agent"],
      excludes: ["AI-powered"],
      mustMentionOneOf: [
        { label: "capability", values: ["legible", "context"] },
      ],
    });
  });

  test("passes examples and threshold through", () => {
    const pub = base();
    pub.tasks[0]!.examples = { pass: ["good"], fail: ["bad"] };
    pub.threshold = 60;
    const c = compilePublicConfig(pub);
    expect(c.scenarios[0]!.examples).toEqual({ pass: ["good"], fail: ["bad"] });
    expect(c.threshold).toBe(60);
  });

  test("compiles a build task to inert internal build metadata", () => {
    const pub = base();
    pub.tasks = [buildTask()];
    const c = compilePublicConfig(pub);
    const s = c.scenarios[0]!;
    expect(s.name).toBe("toolbar");
    expect(s.prompt).toBe("Add a toolbar.");
    expect(s.kind).toBe("build");
    expect(s.workspace).toEqual({
      path: "./fixtures/app",
      setup: ["bun install"],
    });
    expect(s.verify).toEqual(["bun test"]);
    expect(s.trials).toBe(3);
    // Build scenarios carry no answer contract.
    expect(s.expected).toBeUndefined();
    // Access composition is identical to answer tasks.
    expect(s.matrix?.interfaces).toEqual(["quick"]);
    expect(s.matrix?.accessPairs).toEqual([
      { access: "injected", source: "docs", toolset: "none" },
    ]);
  });

  test("a build task without trials defaults to omitted (runner applies 1)", () => {
    const pub = base();
    const t = buildTask();
    t.trials = undefined;
    pub.tasks = [t];
    const c = compilePublicConfig(pub);
    expect(c.scenarios[0]!.trials).toBeUndefined();
  });
});
