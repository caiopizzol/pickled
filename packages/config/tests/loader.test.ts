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

function first<T>(arr: T[] | undefined): T {
  const v = arr?.[0];
  if (v === undefined)
    throw new Error("test fixture: expected a non-empty array");
  return v;
}

const VALID = `
schemaVersion: 2
product:
  name: pickled
  description: Agent legibility checker
sources:
  docs: { url: https://example.com/llms.txt }
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
contexts:
  memory: { mode: memory }
  injected: { mode: inject, source: docs }
  web: { mode: web }
facts:
  install:
    statement: install command
    match: { allOf: ["bunx pickled"] }
questions:
  - id: positioning
    question: what does pickled do?
    agents: [quick, api]
    contexts: [memory, injected, web]
    expects: [install]
thresholds:
  questions: 60
`;

describe("loadConfig pipeline", () => {
  test("loads and resolves a valid v2 config", async () => {
    const dir = makeDir(VALID);
    const config = await loadConfig(dir);
    expect(config.product.name).toBe("pickled");
    expect(config.agents.quick?.category).toBe("cli");
    expect(config.agents.api?.category).toBe("api");
    expect(config.sources.docs).toEqual({
      kind: "url",
      url: "https://example.com/llms.txt",
    });
    expect(config.contexts.memory).toEqual({ mode: "memory" });
    expect(config.thresholds.questions).toBe(60);
    const q = first(config.questions);
    expect(q.id).toBe("positioning");
    expect(q.expects).toEqual(["install"]);
    expect(config.facts.install?.match.allOf).toEqual(["bunx pickled"]);
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

  test("expands env-var placeholders in mcp server headers", async () => {
    process.env.PICKLED_TEST_TOKEN = "secret-123";
    const dir = makeDir(`
schemaVersion: 2
product: { name: t, description: d }
sources:
  docs: { url: https://example.com/llms.txt }
agents:
  api: { provider: openai, model: gpt-5.2 }
contexts:
  m:
    mode: mcp
    source: docs
    servers:
      remote:
        url: https://mcp.example.com/mcp
        headers:
          AUTH: \${PICKLED_TEST_TOKEN}
facts:
  f: { statement: s, match: { allOf: ["x"] } }
questions:
  - id: q
    question: a
    agents: [api]
    contexts: [m]
    expects: [f]
`);
    const config = await loadConfig(dir);
    const ctx = config.contexts.m;
    expect(ctx?.mode).toBe("mcp");
    if (ctx?.mode === "mcp") {
      expect(ctx.servers.remote?.headers?.AUTH).toBe("secret-123");
    }
    process.env.PICKLED_TEST_TOKEN = undefined;
  });

  test("surfaces a v2 validation error (question with no expects/rejects)", async () => {
    const dir = makeDir(`
schemaVersion: 2
product: { name: t, description: d }
agents:
  quick: { provider: claude-code, model: claude-haiku-4-5 }
contexts:
  memory: { mode: memory }
questions:
  - id: q
    question: a
    agents: [quick]
    contexts: [memory]
`);
    await expect(loadConfig(dir)).rejects.toThrow(
      /at least one of expects \/ rejects/,
    );
  });

  test("surfaces an unknown-agent reference", async () => {
    const dir = makeDir(`
schemaVersion: 2
product: { name: t, description: d }
agents:
  quick: { provider: claude-code, model: claude-haiku-4-5 }
contexts:
  memory: { mode: memory }
facts:
  f: { statement: s, match: { allOf: ["x"] } }
questions:
  - id: q
    question: a
    agents: [ghost]
    contexts: [memory]
    expects: [f]
`);
    await expect(loadConfig(dir)).rejects.toThrow(/unknown agent "ghost"/);
  });

  test("rejects a v1 config with a migration hint", async () => {
    const dir = makeDir(`
product: { name: t, description: d }
agents:
  quick: { provider: claude-code, model: claude-haiku-4-5 }
access:
  prior: { source: none, tools: none }
tasks:
  - id: q
    prompt: a
    agents: [quick]
    access: [prior]
    checks: { mustMention: [x] }
`);
    await expect(loadConfig(dir)).rejects.toThrow(/schemaVersion: 2/);
  });
});
