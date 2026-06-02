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

// A config that exercises every section + all three tool modes + all three
// check kinds + examples + threshold. Must pass BOTH validators.
const VALID = `
product: { name: my-product, description: a dev tool }
sources:
  llms: https://my-product.dev/llms.txt
agents:
  quick: { provider: claude-code, model: claude-haiku-4-5, maxTurns: 5 }
  api: { provider: openai, model: gpt-5.2, temperature: 0, maxTokens: 4096 }
access:
  memory: { source: none, tools: none }
  given_llms: { source: llms, tools: none }
  web_llms: { source: llms, tools: web }
  mcp_x:
    source: none
    tools: mcp
    servers:
      s:
        url: https://my-product.dev/mcp
        headers: { Authorization: "Bearer x" }
tasks:
  - id: install
    prompt: How do I install my-product?
    agents: [quick, api]
    access: [memory, given_llms, web_llms, mcp_x]
    checks:
      mustMention: [bunx my-product]
      mustMentionOneOf:
        - { label: package manager, values: [bunx, npx] }
      mustNotMention: [legacyAdapter]
    examples:
      pass: ["install with bunx my-product"]
      fail: ["use legacyAdapter"]
threshold: 80
`;

describe("pickled.schema.json", () => {
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

  // Each bad config plus which validator(s) must reject it. The loader is the
  // authoritative gate; the schema is a shape layer that agrees on structural
  // errors (unknown top-level keys, bad shapes) and is looser only on
  // cross-references (unknown source/agent/access ids), which the loader owns,
  // so those are not listed here.
  const INVALID: Array<{
    label: string;
    yaml: string;
    schemaRejects: boolean;
    loaderRejects: boolean;
  }> = [
    {
      label: "object source (codebase) is not in the public schema",
      yaml: `
product: { name: t, description: d }
sources:
  code: { path: "src/**/*.ts", type: codebase }
agents: { q: { provider: claude-code, model: m } }
access: { m: { source: none, tools: none } }
tasks:
  - { id: q, prompt: a, agents: [q], access: [m], checks: { mustMention: [x] } }
`,
      schemaRejects: true,
      loaderRejects: true,
    },
    {
      label: "tools: mcp without servers",
      yaml: `
product: { name: t, description: d }
agents: { q: { provider: claude-code, model: m } }
access: { mcp_x: { source: none, tools: mcp } }
tasks:
  - { id: q, prompt: a, agents: [q], access: [mcp_x], checks: { mustMention: [x] } }
`,
      schemaRejects: true,
      loaderRejects: true,
    },
    {
      label: "servers on a tools: web path",
      yaml: `
product: { name: t, description: d }
agents: { q: { provider: claude-code, model: m } }
access:
  web_x: { source: none, tools: web, servers: { s: { url: https://x/mcp } } }
tasks:
  - { id: q, prompt: a, agents: [q], access: [web_x], checks: { mustMention: [x] } }
`,
      schemaRejects: true,
      loaderRejects: true,
    },
    {
      label: "empty check array",
      yaml: `
product: { name: t, description: d }
agents: { q: { provider: claude-code, model: m } }
access: { m: { source: none, tools: none } }
tasks:
  - { id: q, prompt: a, agents: [q], access: [m], checks: { mustMention: [] } }
`,
      schemaRejects: true,
      loaderRejects: true,
    },
    {
      label: "type inside an MCP server",
      yaml: `
product: { name: t, description: d }
agents: { q: { provider: claude-code, model: m } }
access:
  mcp_x:
    source: none
    tools: mcp
    servers: { s: { type: stdio, command: foo, url: https://x/mcp } }
tasks:
  - { id: q, prompt: a, agents: [q], access: [mcp_x], checks: { mustMention: [x] } }
`,
      schemaRejects: true,
      loaderRejects: true,
    },
    {
      label: "MCP server url is not http(s)",
      yaml: `
product: { name: t, description: d }
agents: { q: { provider: claude-code, model: m } }
access:
  mcp_x:
    source: none
    tools: mcp
    servers: { s: { url: ftp://x/mcp } }
tasks:
  - { id: q, prompt: a, agents: [q], access: [mcp_x], checks: { mustMention: [x] } }
`,
      schemaRejects: true,
      loaderRejects: true,
    },
    {
      label: "bad examples shape (pass is not an array)",
      yaml: `
product: { name: t, description: d }
agents: { q: { provider: claude-code, model: m } }
access: { m: { source: none, tools: none } }
tasks:
  - id: q
    prompt: a
    agents: [q]
    access: [m]
    checks: { mustMention: [x] }
    examples: { pass: "not an array" }
`,
      schemaRejects: true,
      loaderRejects: true,
    },
    {
      label: "unknown top-level key (rejected by both)",
      yaml: `
product: { name: t, description: d }
agents: { q: { provider: claude-code, model: m } }
access: { m: { source: none, tools: none } }
tasks:
  - { id: q, prompt: a, agents: [q], access: [m], checks: { mustMention: [x] } }
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
