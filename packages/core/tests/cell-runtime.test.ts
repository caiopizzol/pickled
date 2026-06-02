import { describe, expect, test } from "bun:test";
import type { CheckConfig, ResolvedDocSource } from "@pickled-dev/config";
import { resolveCellRuntime } from "../src/cell-runtime.js";

const DOCS: ResolvedDocSource[] = [
  {
    id: "llms",
    source: "https://x.dev/llms.txt",
    content: "DOC CONTENT",
    name: "llms.txt",
    type: "url",
  },
];

function config(provider: string, category: "cli" | "api"): CheckConfig {
  return {
    tool: { name: "t", description: "d" },
    targets: { agent: { category, provider, model: "m" } },
    toolsets: {
      none: {},
      web: { webSearch: true, webFetch: true },
      websearch: { webSearch: true },
      mcp: { mcpServers: { mintlify: { type: "http", url: "https://x/mcp" } } },
      empty: {},
    },
    docs: { sources: { llms: "./llms.txt" } },
    scenarios: [],
  };
}

function resolve(args: {
  provider: string;
  category: "cli" | "api";
  source: string | null;
  toolset: string;
}) {
  return resolveCellRuntime({
    interfaceName: "agent",
    sourceName: args.source,
    toolsetName: args.toolset,
    config: config(args.provider, args.category),
    docs: DOCS,
    requiredSources: ["llms"],
    contextConfig: { allowedTools: ["Read"] },
  });
}

describe("resolveCellRuntime", () => {
  test("tools:none + source injects docs and passes the context", () => {
    const rt = resolve({
      provider: "claude-code",
      category: "cli",
      source: "llms",
      toolset: "none",
    });
    expect(rt.isInjecting).toBe(true);
    expect(rt.cellDocs.map((d) => d.id)).toEqual(["llms"]);
    expect(rt.surfaceIds).toEqual(["llms"]);
    expect(rt.requiredInCell).toEqual(["llms"]);
    expect(rt.cellContext).toEqual({ allowedTools: ["Read"] });
    expect(rt.discoveryHint).toBeUndefined();
    expect(rt.runOptions.restrictBuiltinTools).toBeUndefined();
  });

  test("tools:web + source does not inject docs and returns a discovery hint", () => {
    const rt = resolve({
      provider: "claude-code",
      category: "cli",
      source: "llms",
      toolset: "web",
    });
    expect(rt.isInjecting).toBe(false);
    expect(rt.cellDocs).toEqual([]);
    expect(rt.requiredInCell).toEqual([]);
    expect(rt.cellContext).toBeUndefined();
    expect(rt.discoveryHint).toEqual({ sourceHint: "https://x.dev/llms.txt" });
  });

  test("Claude web scopes built-ins to WebSearch/WebFetch", () => {
    const rt = resolve({
      provider: "claude-code",
      category: "cli",
      source: "none",
      toolset: "web",
    });
    expect(rt.runOptions.restrictBuiltinTools).toEqual([
      "WebSearch",
      "WebFetch",
    ]);
    expect(rt.runOptions.webTools).toBeUndefined();
    expect(rt.provenance.expectedLabels).toEqual(["WebSearch", "WebFetch"]);
  });

  test("Claude MCP disables built-ins and wires the servers", () => {
    const rt = resolve({
      provider: "claude-code",
      category: "cli",
      source: "none",
      toolset: "mcp",
    });
    expect(rt.runOptions.restrictBuiltinTools).toEqual([]);
    expect(rt.targetConfig.mcpServers).toBeDefined();
    expect(rt.provenance.expectedLabels).toEqual(["mcp__mintlify__*"]);
    expect(rt.provenance.match("mcp__mintlify__search")).toBe(true);
    expect(rt.provenance.match("WebSearch")).toBe(false);
  });

  test("server-side web (openai) wires webTools and the web_search label, target config untouched", () => {
    const rt = resolve({
      provider: "openai",
      category: "api",
      source: "none",
      toolset: "websearch",
    });
    expect(rt.runOptions.webTools).toEqual({ search: true });
    expect(rt.runOptions.restrictBuiltinTools).toEqual([]);
    expect(rt.provenance.expectedLabels).toEqual(["web_search"]);
    // server-web targets pass baseTargetConfig through unchanged
    expect(rt.targetConfig).toBe(rt.baseTargetConfig);
  });

  test("server API webFetch-only throws (no fetch primitive on the API)", () => {
    const cfg = config("openai", "api");
    cfg.toolsets = { fetchonly: { webFetch: true } };
    expect(() =>
      resolveCellRuntime({
        interfaceName: "agent",
        sourceName: "none",
        toolsetName: "fetchonly",
        config: cfg,
        docs: DOCS,
        requiredSources: [],
        contextConfig: {},
      }),
    ).toThrow(/requires webSearch: true/);
  });

  test("mixed web + MCP in one toolset throws", () => {
    const cfg = config("claude-code", "cli");
    cfg.toolsets = {
      mixed: {
        webSearch: true,
        mcpServers: { m: { type: "http", url: "https://x/mcp" } },
      },
    };
    expect(() =>
      resolveCellRuntime({
        interfaceName: "agent",
        sourceName: "none",
        toolsetName: "mixed",
        config: cfg,
        docs: DOCS,
        requiredSources: [],
        contextConfig: {},
      }),
    ).toThrow(/mixes webSearch\/webFetch with mcpServers/);
  });

  test("MCP on an unsupported provider throws before the target runs", () => {
    expect(() =>
      resolve({
        provider: "codex-cli",
        category: "cli",
        source: "none",
        toolset: "mcp",
      }),
    ).toThrow(/MCP\) is implemented on claude-code and openai/);
  });

  test("a toolset with no recognized shape throws", () => {
    expect(() =>
      resolve({
        provider: "claude-code",
        category: "cli",
        source: "none",
        toolset: "empty",
      }),
    ).toThrow(/defines no runtime shape/);
  });
});
