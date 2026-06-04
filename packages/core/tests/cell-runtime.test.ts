import { describe, expect, test } from "bun:test";
import type {
  Config,
  Context,
  ResolvedSource,
  TargetCategory,
} from "@pickled-dev/config";
import { resolveCellRuntime } from "../src/cell-runtime.js";

const SOURCES: ResolvedSource[] = [
  {
    id: "llms",
    type: "url",
    source: "https://x.dev/llms.txt",
    content: "DOC CONTENT",
    name: "llms.txt",
  },
];

function config(provider: string, category: TargetCategory): Config {
  return {
    product: { name: "t", description: "d" },
    sources: { llms: { kind: "url", url: "https://x.dev/llms.txt" } },
    agents: { agent: { category, provider, model: "m" } },
    contexts: {},
    facts: {},
    misstatements: {},
    questions: [],
    builds: [],
    thresholds: {},
  };
}

function resolve(args: {
  provider: string;
  category: TargetCategory;
  context: Context;
}) {
  return resolveCellRuntime({
    agent: "agent",
    context: args.context,
    config: config(args.provider, args.category),
    sources: SOURCES,
    kind: "question",
  });
}

describe("resolveCellRuntime", () => {
  test("memory: no injection, no provenance, bare prompt context", () => {
    const rt = resolve({
      provider: "claude-code",
      category: "cli",
      context: { mode: "memory" },
    });
    expect(rt.promptContext).toEqual({ kind: "question", mode: "memory" });
    expect(rt.provenance.hasMatchers).toBe(false);
    // Question memory/inject cells are scoped to NO tools so Claude Code cannot
    // silently web-search and defeat what the cell measures.
    expect(rt.runOptions.restrictBuiltinTools).toEqual([]);
    expect(rt.sourceId).toBeNull();
  });

  test("inject: places the source in the prompt context, no provenance", () => {
    const rt = resolve({
      provider: "claude-code",
      category: "cli",
      context: { mode: "inject", source: "llms" },
    });
    expect(rt.promptContext.kind).toBe("question");
    expect(rt.promptContext.mode).toBe("inject");
    if (rt.promptContext.mode === "inject") {
      expect(rt.promptContext.docs.map((d) => d.id)).toEqual(["llms"]);
    }
    expect(rt.provenance.hasMatchers).toBe(false);
    expect(rt.runOptions.restrictBuiltinTools).toEqual([]); // no tools in inject
    expect(rt.sourceId).toBe("llms");
  });

  test("build memory/inject cells are NOT tool-stripped (they keep the edit profile)", () => {
    for (const context of [
      { mode: "memory" } as const,
      { mode: "inject", source: "llms" } as const,
    ]) {
      const rt = resolveCellRuntime({
        agent: "agent",
        context,
        config: config("claude-code", "cli"),
        sources: SOURCES,
        kind: "build",
      });
      expect(rt.runOptions.restrictBuiltinTools).toBeUndefined();
    }
  });

  test("web (claude-code): scopes built-ins, names the discovery hint, sets provenance", () => {
    const rt = resolve({
      provider: "claude-code",
      category: "cli",
      context: { mode: "web", source: "llms" },
    });
    expect(rt.promptContext.mode).toBe("web");
    if (rt.promptContext.mode === "web") {
      expect(rt.promptContext.sourceHint).toBe("https://x.dev/llms.txt");
    }
    expect(rt.runOptions.restrictBuiltinTools).toEqual([
      "WebSearch",
      "WebFetch",
    ]);
    expect(rt.runOptions.webTools).toBeUndefined();
    expect(rt.provenance.expectedLabels).toEqual(["WebSearch", "WebFetch"]);
    expect(rt.provenance.match("WebSearch")).toBe(true);
  });

  test("web (open discovery, no source): sourceHint null", () => {
    const rt = resolve({
      provider: "claude-code",
      category: "cli",
      context: { mode: "web" },
    });
    if (rt.promptContext.mode === "web") {
      expect(rt.promptContext.sourceHint).toBeNull();
    }
    expect(rt.sourceId).toBeNull();
  });

  test("web (openai server): wires webTools, web_search provenance, target untouched", () => {
    const rt = resolve({
      provider: "openai",
      category: "api",
      context: { mode: "web", source: "llms" },
    });
    expect(rt.runOptions.webTools).toEqual({ search: true });
    expect(rt.runOptions.restrictBuiltinTools).toBeUndefined();
    expect(rt.provenance.expectedLabels).toEqual(["web_search"]);
  });

  test("mcp (claude-code): wires servers + provenance, scopes built-ins", () => {
    const rt = resolve({
      provider: "claude-code",
      category: "cli",
      context: {
        mode: "mcp",
        servers: { mintlify: { type: "http", url: "https://x/mcp" } },
      },
    });
    expect(rt.target.mcpServers).toBeDefined();
    expect(rt.provenance.expectedLabels).toEqual(["mcp__mintlify__*"]);
    expect(rt.provenance.match("mcp__mintlify__search")).toBe(true);
    expect(rt.provenance.match("WebSearch")).toBe(false);
  });

  test("mcp (openai): wires mcpTools, normalized provenance", () => {
    const rt = resolve({
      provider: "openai",
      category: "api",
      context: {
        mode: "mcp",
        servers: { mintlify: { type: "http", url: "https://x/mcp" } },
      },
    });
    expect(rt.runOptions.mcpTools?.servers.mintlify).toBeDefined();
    expect(rt.provenance.match("mcp__mintlify__search")).toBe(true);
  });

  test("web on codex throws before any run", () => {
    expect(() =>
      resolve({
        provider: "codex-cli",
        category: "cli",
        context: { mode: "web", source: "llms" },
      }),
    ).toThrow(/mode "web" is not supported on provider "codex-cli"/);
  });

  test("mcp on codex throws", () => {
    expect(() =>
      resolve({
        provider: "codex-cli",
        category: "cli",
        context: {
          mode: "mcp",
          servers: { m: { type: "http", url: "https://x/mcp" } },
        },
      }),
    ).toThrow(/mode "mcp" is not supported on provider "codex-cli"/);
  });

  test("mcp on anthropic throws (web-only API)", () => {
    expect(() =>
      resolve({
        provider: "anthropic",
        category: "api",
        context: {
          mode: "mcp",
          servers: { m: { type: "http", url: "https://x/mcp" } },
        },
      }),
    ).toThrow(/mode "mcp" is not supported on provider "anthropic"/);
  });
});
