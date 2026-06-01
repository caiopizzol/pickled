import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "@pickled-dev/config";

// Integration smoke for the new public schema, exercised through the
// package export the core consumers actually import. The exhaustive
// validate/compile coverage lives in packages/config/tests/transform.test.ts
// and loader.test.ts; this file guards the workspace contract end to end.

function withTempConfig<T>(
  yaml: string,
  fn: (dir: string) => Promise<T>,
): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "pickled-config-"));
  writeFileSync(join(dir, "pickled.yml"), yaml);
  return fn(dir).finally(() => rmSync(dir, { recursive: true, force: true }));
}

const REALISTIC = `
product:
  name: pickled
  description: Agent legibility checker for developer tools
sources:
  docs: https://example.com/llms.txt
  readme: ./README.md
agents:
  quick:
    provider: claude-code
    model: claude-haiku-4-5
    maxTurns: 5
  api:
    provider: anthropic
    model: claude-haiku-4-5
    temperature: 0
    maxTokens: 4096
access:
  prior: { source: none, tools: none }
  injected: { source: docs, tools: none }
  web: { source: none, tools: web }
questions:
  - id: positioning
    ask: In one or two sentences, what does pickled do?
    agents: [quick, api]
    access: [prior, injected, web]
    checks:
      mustMention: [agent]
      mustMentionOneOf:
        - label: names the capability
          values: [legible, context]
      mustNotMention: [AI-powered]
    examples:
      pass: ["pickled checks whether an agent reaches the right context"]
      fail: ["it is a build tool"]
threshold: 60
`;

describe("loadConfig (new public schema, via package export)", () => {
  test("compiles a realistic config into a runnable CheckConfig", async () => {
    await withTempConfig(REALISTIC, async (dir) => {
      const config = await loadConfig(dir);
      expect(config.tool).toEqual({
        name: "pickled",
        description: "Agent legibility checker for developer tools",
      });
      // Provider -> category inference.
      expect(config.targets?.quick?.category).toBe("cli");
      expect(config.targets?.quick?.maxTurns).toBe(5);
      expect(config.targets?.api?.category).toBe("api");
      expect(config.targets?.api?.temperature).toBe(0);
      // Toolset synthesis: shared "none" baseline + access-named web set.
      expect(config.toolsets?.none).toEqual({});
      expect(config.toolsets?.web).toEqual({ webSearch: true, webFetch: true });
      // Sources carried through as strings.
      expect(config.docs?.sources?.readme).toBe("./README.md");
      expect(config.threshold).toBe(60);
    });
  });

  test("question compiles to a scenario with interfaces + sparse accessPairs", async () => {
    await withTempConfig(REALISTIC, async (dir) => {
      const config = await loadConfig(dir);
      const s = config.scenarios[0]!;
      expect(s.name).toBe("positioning");
      expect(s.prompt).toContain("what does pickled do");
      expect(s.matrix?.interfaces).toEqual(["quick", "api"]);
      expect(s.matrix?.accessPairs).toEqual([
        { access: "prior", source: "none", toolset: "none" },
        { access: "injected", source: "docs", toolset: "none" },
        { access: "web", source: "none", toolset: "web" },
      ]);
    });
  });

  test('source: none compiles to the string "none", never null', async () => {
    await withTempConfig(REALISTIC, async (dir) => {
      const config = await loadConfig(dir);
      const pairs = config.scenarios[0]!.matrix?.accessPairs ?? [];
      expect(pairs.some((p) => p.source === null)).toBe(false);
      expect(pairs).toContainEqual({
        access: "prior",
        source: "none",
        toolset: "none",
      });
    });
  });

  test("checks map to expected includes/excludes/mustMentionOneOf", async () => {
    await withTempConfig(REALISTIC, async (dir) => {
      const config = await loadConfig(dir);
      const expected = config.scenarios[0]!.expected!;
      expect(expected.includes).toEqual(["agent"]);
      expect(expected.excludes).toEqual(["AI-powered"]);
      expect(expected.mustMentionOneOf).toEqual([
        { label: "names the capability", values: ["legible", "context"] },
      ]);
    });
  });

  test("examples carry through for offline `pickled test`", async () => {
    await withTempConfig(REALISTIC, async (dir) => {
      const config = await loadConfig(dir);
      expect(config.scenarios[0]!.examples?.pass).toHaveLength(1);
      expect(config.scenarios[0]!.examples?.fail).toHaveLength(1);
    });
  });

  test("rejects a question referencing unknown access", async () => {
    const yaml = `
product: { name: t, description: d }
agents:
  quick: { provider: claude-code, model: claude-haiku-4-5 }
access:
  prior: { source: none, tools: none }
questions:
  - id: q
    ask: a
    agents: [quick]
    access: [ghost]
    checks: { mustMention: [x] }
`;
    await withTempConfig(yaml, async (dir) => {
      await expect(loadConfig(dir)).rejects.toThrow(/unknown access "ghost"/);
    });
  });

  test("rejects a question with no checks declared", async () => {
    const yaml = `
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
`;
    await withTempConfig(yaml, async (dir) => {
      await expect(loadConfig(dir)).rejects.toThrow(
        /needs at least one of checks/,
      );
    });
  });
});
