import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import _Ajv2020 from "ajv/dist/2020";
import YAML from "yaml";
import { loadConfig } from "../src/loader.js";

// ajv ships CJS; tolerate either interop shape under Bun.
const Ajv2020 = ((_Ajv2020 as { default?: unknown }).default ??
  _Ajv2020) as typeof _Ajv2020;

const SCHEMA_SRC = join(import.meta.dir, "../schema/pickled.schema.json");
const SCHEMA_SERVED = join(
  import.meta.dir,
  "../../../apps/web/public/schema/pickled.schema.json",
);

const schema = JSON.parse(readFileSync(SCHEMA_SRC, "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: false });
const validate = ajv.compile(schema);

const created: string[] = [];
afterEach(() => {
  for (const d of created.splice(0))
    rmSync(d, { recursive: true, force: true });
});

function schemaAccepts(yaml: string): boolean {
  return validate(YAML.parse(yaml)) as boolean;
}
async function loaderAccepts(yaml: string): Promise<boolean> {
  const dir = mkdtempSync(join(tmpdir(), "pk-schema-"));
  created.push(dir);
  writeFileSync(join(dir, "pickled.yml"), yaml);
  try {
    await loadConfig(dir);
    return true;
  } catch {
    return false;
  }
}

// Exercises every v2 section + all four context modes + a fact + a misstatement
// + a question (expects/rejects + examples) + a build (verifier) + thresholds.
// Must pass BOTH validators.
const VALID = `
schemaVersion: 2
product: { name: my-product, description: a dev tool }
sources:
  llms: { url: https://my-product.dev/llms.txt }
agents:
  quick: { provider: claude-code, model: claude-haiku-4-5, maxTurns: 5 }
  api: { provider: openai, model: gpt-5.2, temperature: 0, maxTokens: 4096 }
contexts:
  memory: { mode: memory }
  given_llms: { mode: inject, source: llms }
  web_llms: { mode: web, source: llms }
  mcp_x:
    mode: mcp
    servers:
      s: { url: https://my-product.dev/mcp, headers: { Authorization: "Bearer x" } }
facts:
  install: { statement: install command, match: { allOf: ["bunx my-product"] } }
misstatements:
  legacy: { statement: legacy adapter, match: { anyOf: ["legacyAdapter"] } }
questions:
  - id: install
    question: How do I install my-product?
    agents: [quick, api]
    contexts: [memory, given_llms, web_llms, mcp_x]
    expects: [install]
    rejects: [legacy]
    examples:
      pass: ["install with bunx my-product"]
      fail: ["use legacyAdapter"]
builds:
  - id: smoke
    goal: Add a basic usage.
    agents: [quick]
    contexts: [given_llms]
    trials: 2
    workspace: { path: ./fixtures/app, setup: [bun install] }
    verifier:
      failToPass: [{ name: tests, run: bun test }]
      passToPass: [{ run: bun run typecheck }]
thresholds:
  questions: 80
  builds: 80
`;

describe("pickled.schema.json (v2)", () => {
  test("schema compiles under JSON Schema 2020-12", () => {
    expect(typeof validate).toBe("function");
  });

  test("source-of-truth and served copy are byte-identical", () => {
    expect(readFileSync(SCHEMA_SRC, "utf8")).toBe(
      readFileSync(SCHEMA_SERVED, "utf8"),
    );
  });

  test("a valid config passes both the schema and the loader", async () => {
    expect(schemaAccepts(VALID)).toBe(true);
    expect(await loaderAccepts(VALID)).toBe(true);
  });

  // Each bad config plus which validator(s) reject it. The loader is the
  // authoritative gate; the schema agrees on structural errors (unknown keys,
  // bad shapes, missing schemaVersion) and is looser on cross-references
  // (unknown source/agent/fact ids) and mode rules, which the loader owns.
  const INVALID: Array<{
    label: string;
    yaml: string;
    schemaRejects: boolean;
    loaderRejects: boolean;
  }> = [
    {
      label: "missing schemaVersion",
      yaml: `
product: { name: t, description: d }
agents: { q: { provider: claude-code, model: m } }
contexts: { mem: { mode: memory } }
facts: { f: { statement: s, match: { allOf: ["x"] } } }
questions:
  - { id: q, question: a, agents: [q], contexts: [mem], expects: [f] }
`,
      schemaRejects: true,
      loaderRejects: true,
    },
    {
      label: "v1 'tasks' key present",
      yaml: `
schemaVersion: 2
product: { name: t, description: d }
agents: { q: { provider: claude-code, model: m } }
contexts: { mem: { mode: memory } }
tasks: []
`,
      schemaRejects: true,
      loaderRejects: true,
    },
    {
      label: "context mode outside the enum",
      yaml: `
schemaVersion: 2
product: { name: t, description: d }
agents: { q: { provider: claude-code, model: m } }
contexts: { x: { mode: firecrawl } }
facts: { f: { statement: s, match: { allOf: ["x"] } } }
questions:
  - { id: q, question: a, agents: [q], contexts: [x], expects: [f] }
`,
      schemaRejects: true,
      loaderRejects: true,
    },
    {
      label: "match with neither allOf nor anyOf",
      yaml: `
schemaVersion: 2
product: { name: t, description: d }
agents: { q: { provider: claude-code, model: m } }
contexts: { mem: { mode: memory } }
facts: { f: { statement: s, match: {} } }
questions:
  - { id: q, question: a, agents: [q], contexts: [mem], expects: [f] }
`,
      schemaRejects: true,
      loaderRejects: true,
    },
    {
      label: "MCP server url is not http(s)",
      yaml: `
schemaVersion: 2
product: { name: t, description: d }
agents: { q: { provider: claude-code, model: m } }
contexts:
  m: { mode: mcp, servers: { s: { url: ftp://x/mcp } } }
facts: { f: { statement: s, match: { allOf: ["x"] } } }
questions:
  - { id: q, question: a, agents: [q], contexts: [m], expects: [f] }
`,
      schemaRejects: true,
      loaderRejects: true,
    },
    {
      label: "build verifier missing failToPass",
      yaml: `
schemaVersion: 2
product: { name: t, description: d }
agents: { q: { provider: claude-code, model: m } }
contexts: { mem: { mode: memory } }
builds:
  - id: b
    goal: g
    agents: [q]
    contexts: [mem]
    workspace: { path: ./ws }
    verifier: {}
`,
      schemaRejects: true,
      loaderRejects: true,
    },
    {
      label: "unknown top-level key",
      yaml: `
schemaVersion: 2
product: { name: t, description: d }
agents: { q: { provider: claude-code, model: m } }
contexts: { mem: { mode: memory } }
facts: { f: { statement: s, match: { allOf: ["x"] } } }
questions:
  - { id: q, question: a, agents: [q], contexts: [mem], expects: [f] }
typo_section: oops
`,
      schemaRejects: true,
      loaderRejects: true,
    },
  ];

  describe("invalid configs", () => {
    for (const c of INVALID) {
      test(c.label, async () => {
        expect(schemaAccepts(c.yaml)).toBe(!c.schemaRejects);
        expect(await loaderAccepts(c.yaml)).toBe(!c.loaderRejects);
      });
    }
  });
});
