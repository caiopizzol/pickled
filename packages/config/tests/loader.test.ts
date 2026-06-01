import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/loader.js";

const created: string[] = [];

afterEach(() => {
  for (const d of created.splice(0)) {
    rmSync(d, { recursive: true, force: true });
  }
});

function makeDir(yml: string): string {
  const dir = mkdtempSync(join(tmpdir(), "pickled-loader-"));
  created.push(dir);
  writeFileSync(join(dir, "pickled.yml"), yml);
  return dir;
}

const VALID = `
product:
  name: pickled
  description: Agent legibility checker
sources:
  docs: https://example.com/llms.txt
agents:
  quick:
    provider: claude-code
    model: claude-haiku-4-5
    maxTurns: 5
  api:
    provider: openai
    model: gpt-5.2
    temperature: 0
    maxTokens: 4096
access:
  prior: { source: none, tools: none }
  injected: { source: docs, tools: none }
  web: { source: none, tools: web }
questions:
  - id: positioning
    ask: what does pickled do?
    agents: [quick, api]
    access: [prior, injected, web]
    checks:
      mustMention: [agent]
      mustNotMention: [AI-powered]
threshold: 60
`;

describe("loadConfig pipeline", () => {
  test("compiles a valid new-schema config to the internal CheckConfig", async () => {
    const dir = makeDir(VALID);
    const config = await loadConfig(dir);
    expect(config.tool.name).toBe("pickled");
    expect(config.targets?.quick?.category).toBe("cli");
    expect(config.targets?.api?.category).toBe("api");
    expect(config.toolsets?.none).toEqual({});
    expect(config.toolsets?.web).toEqual({ webSearch: true, webFetch: true });
    expect(config.docs?.sources?.docs).toBe("https://example.com/llms.txt");
    expect(config.threshold).toBe(60);
    const s = config.scenarios[0]!;
    expect(s.name).toBe("positioning");
    expect(s.matrix?.interfaces).toEqual(["quick", "api"]);
    expect(s.matrix?.accessPairs).toContainEqual({
      access: "prior",
      source: "none",
      toolset: "none",
    });
    expect(s.expected?.includes).toEqual(["agent"]);
    expect(s.expected?.excludes).toEqual(["AI-powered"]);
  });

  test("throws when pickled.yml is missing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pickled-loader-"));
    created.push(dir);
    await expect(loadConfig(dir)).rejects.toThrow(/pickled\.yml not found/);
  });

  test("throws on malformed YAML", async () => {
    const dir = makeDir("product: {{{ not yaml");
    await expect(loadConfig(dir)).rejects.toThrow(/Failed to parse/);
  });

  test("expands ${ENV} in source values and mcp server headers", async () => {
    process.env.PICKLED_TEST_TOKEN = "secret-123";
    const dir = makeDir(`
product: { name: t, description: d }
sources:
  docs: https://example.com/llms.txt
agents:
  api: { provider: openai, model: gpt-5.2 }
access:
  mcp:
    source: docs
    tools: mcp
    servers:
      remote:
        url: https://mcp.example.com/mcp
        headers:
          AUTH: \${PICKLED_TEST_TOKEN}
questions:
  - id: q
    ask: a
    agents: [api]
    access: [mcp]
    checks: { mustMention: [x] }
`);
    const config = await loadConfig(dir);
    expect(config.toolsets?.mcp?.mcpServers?.remote?.headers?.AUTH).toBe(
      "secret-123",
    );
    process.env.PICKLED_TEST_TOKEN = undefined;
  });

  test("surfaces a public validation error (question with no checks)", async () => {
    const dir = makeDir(`
product: { name: t, description: d }
agents:
  quick: { provider: claude-code, model: claude-haiku-4-5 }
access:
  prior: { source: none, tools: none }
questions:
  - id: q
    ask: a
    agents: [quick]
    access: [prior]
    checks: {}
`);
    await expect(loadConfig(dir)).rejects.toThrow(
      /needs at least one of checks/,
    );
  });

  test("surfaces an unknown-agent reference in public vocabulary", async () => {
    const dir = makeDir(`
product: { name: t, description: d }
agents:
  quick: { provider: claude-code, model: claude-haiku-4-5 }
access:
  prior: { source: none, tools: none }
questions:
  - id: q
    ask: a
    agents: [ghost]
    access: [prior]
    checks: { mustMention: [x] }
`);
    await expect(loadConfig(dir)).rejects.toThrow(/unknown agent "ghost"/);
  });

  test('rejects a source id named "none"', async () => {
    const dir = makeDir(`
product: { name: t, description: d }
sources:
  none: ./x.md
agents:
  quick: { provider: claude-code, model: claude-haiku-4-5 }
access:
  prior: { source: none, tools: none }
questions:
  - id: q
    ask: a
    agents: [quick]
    access: [prior]
    checks: { mustMention: [x] }
`);
    await expect(loadConfig(dir)).rejects.toThrow(
      /source id "none" is reserved/,
    );
  });

  test("rejects a CLI-only field on an API agent (internal backstop)", async () => {
    const dir = makeDir(`
product: { name: t, description: d }
agents:
  api: { provider: openai, model: gpt-5.2, maxTurns: 5 }
access:
  prior: { source: none, tools: none }
questions:
  - id: q
    ask: a
    agents: [api]
    access: [prior]
    checks: { mustMention: [x] }
`);
    await expect(loadConfig(dir)).rejects.toThrow(/maxTurns/);
  });
});
