import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "@pickled-dev/config";

function withTempConfig<T>(
  yaml: string,
  fn: (dir: string) => Promise<T>,
): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "pickled-config-"));
  writeFileSync(join(dir, "pickled.yml"), yaml);
  return fn(dir).finally(() => rmSync(dir, { recursive: true, force: true }));
}

describe("loadConfig", () => {
  test("accepts a minimal config with docs.sources and requiredSources", async () => {
    const yaml = `
tool:
  name: zod
  description: schema validation
docs:
  sources:
    readme: ./README.md
scenarios:
  - name: install
    prompt: how to install
    requiredSources: [readme]
`;
    await withTempConfig(yaml, async (dir) => {
      const cfg = await loadConfig(dir);
      expect(cfg.tool.name).toBe("zod");
      expect(cfg.docs?.sources.readme).toBe("./README.md");
      expect(cfg.scenarios[0]!.requiredSources).toEqual(["readme"]);
    });
  });

  test("accepts requiredSources: []", async () => {
    const yaml = `
tool:
  name: t
  description: d
docs:
  sources:
    a: ./a.md
scenarios:
  - name: s
    prompt: p
    requiredSources: []
`;
    await withTempConfig(yaml, async (dir) => {
      const cfg = await loadConfig(dir);
      expect(cfg.scenarios[0]!.requiredSources).toEqual([]);
    });
  });

  test("rejects scenario without requiredSources", async () => {
    const yaml = `
tool:
  name: t
  description: d
scenarios:
  - name: s
    prompt: p
`;
    await withTempConfig(yaml, async (dir) => {
      await expect(loadConfig(dir)).rejects.toThrow(/requiredSources/);
    });
  });

  test("rejects scenario referencing unknown source ID", async () => {
    const yaml = `
tool:
  name: t
  description: d
docs:
  sources:
    a: ./a.md
scenarios:
  - name: s
    prompt: p
    requiredSources: [b]
`;
    await withTempConfig(yaml, async (dir) => {
      await expect(loadConfig(dir)).rejects.toThrow(/unknown source "b"/);
    });
  });

  test("rejects missing tool.name", async () => {
    const yaml = `
tool:
  description: d
scenarios:
  - name: s
    prompt: p
    requiredSources: []
`;
    await withTempConfig(yaml, async (dir) => {
      await expect(loadConfig(dir)).rejects.toThrow(/tool.name/);
    });
  });

  test("rejects empty scenarios", async () => {
    const yaml = `
tool:
  name: t
  description: d
scenarios: []
`;
    await withTempConfig(yaml, async (dir) => {
      await expect(loadConfig(dir)).rejects.toThrow(/non-empty/);
    });
  });

  test("rejects object docs.sources values without 'path'", async () => {
    const yaml = `
tool:
  name: t
  description: d
docs:
  sources:
    bad:
      nested: object
scenarios:
  - name: s
    prompt: p
    requiredSources: [bad]
`;
    await withTempConfig(yaml, async (dir) => {
      await expect(loadConfig(dir)).rejects.toThrow(
        /docs.sources\["bad"\] object form requires a non-empty 'path' field/,
      );
    });
  });

  test("rejects empty-string docs.sources values", async () => {
    const yaml = `
tool:
  name: t
  description: d
docs:
  sources:
    empty: ""
scenarios:
  - name: s
    prompt: p
    requiredSources: [empty]
`;
    await withTempConfig(yaml, async (dir) => {
      await expect(loadConfig(dir)).rejects.toThrow(
        /docs.sources\["empty"\] string form must be a non-empty file path or URL/,
      );
    });
  });

  test("accepts object form with path only", async () => {
    const yaml = `
tool:
  name: t
  description: d
docs:
  sources:
    readme:
      path: ./README.md
scenarios:
  - name: s
    prompt: p
    requiredSources: [readme]
`;
    await withTempConfig(yaml, async (dir) => {
      const cfg = await loadConfig(dir);
      expect(cfg.docs?.sources.readme).toEqual({ path: "./README.md" });
    });
  });

  test("accepts object form with audit.traps: false", async () => {
    const yaml = `
tool:
  name: t
  description: d
docs:
  sources:
    stale:
      path: ./stale.md
      audit:
        traps: false
scenarios:
  - name: s
    prompt: p
    requiredSources: [stale]
`;
    await withTempConfig(yaml, async (dir) => {
      const cfg = await loadConfig(dir);
      const stale = cfg.docs?.sources.stale;
      expect(stale).toBeDefined();
      if (typeof stale === "string") {
        throw new Error("expected object form");
      }
      expect(stale?.audit?.traps).toBe(false);
    });
  });

  test("accepts mixed string and object source forms", async () => {
    const yaml = `
tool:
  name: t
  description: d
docs:
  sources:
    plain: ./plain.md
    objectFormDefault:
      path: ./object.md
    objectFormOptOut:
      path: ./optout.md
      audit:
        traps: false
scenarios:
  - name: s
    prompt: p
    requiredSources: [plain, objectFormDefault, objectFormOptOut]
`;
    await withTempConfig(yaml, async (dir) => {
      const cfg = await loadConfig(dir);
      expect(typeof cfg.docs?.sources.plain).toBe("string");
      expect(typeof cfg.docs?.sources.objectFormDefault).toBe("object");
      expect(typeof cfg.docs?.sources.objectFormOptOut).toBe("object");
    });
  });

  test("rejects unknown field on object source form", async () => {
    const yaml = `
tool:
  name: t
  description: d
docs:
  sources:
    bad:
      path: ./bad.md
      unknownField: true
scenarios:
  - name: s
    prompt: p
    requiredSources: [bad]
`;
    await withTempConfig(yaml, async (dir) => {
      await expect(loadConfig(dir)).rejects.toThrow(
        /docs.sources\["bad"\] has unknown field "unknownField"/,
      );
    });
  });

  test("rejects unknown field on source audit object", async () => {
    const yaml = `
tool:
  name: t
  description: d
docs:
  sources:
    bad:
      path: ./bad.md
      audit:
        traps: false
        bogus: true
scenarios:
  - name: s
    prompt: p
    requiredSources: [bad]
`;
    await withTempConfig(yaml, async (dir) => {
      await expect(loadConfig(dir)).rejects.toThrow(
        /docs.sources\["bad"\].audit has unknown field "bogus"/,
      );
    });
  });

  test("rejects audit.traps that is neither boolean nor array", async () => {
    const yaml = `
tool:
  name: t
  description: d
docs:
  sources:
    bad:
      path: ./bad.md
      audit:
        traps: "false"
scenarios:
  - name: s
    prompt: p
    requiredSources: [bad]
`;
    await withTempConfig(yaml, async (dir) => {
      await expect(loadConfig(dir)).rejects.toThrow(
        /audit.traps must be a boolean or an array of trap ids/,
      );
    });
  });

  test("accepts audit.traps as a string array (list-form suppression)", async () => {
    const yaml = `
tool:
  name: t
  description: d
docs:
  sources:
    policy:
      path: ./policy.md
      audit:
        traps: [t1, t2]
scenarios:
  - name: s
    prompt: p
    requiredSources: [policy]
    traps:
      - id: t1
        match: "foo"
        reason: "r1"
      - id: t2
        match: "bar"
        reason: "r2"
`;
    await withTempConfig(yaml, async (dir) => {
      const cfg = await loadConfig(dir);
      const src = cfg.docs?.sources.policy;
      if (typeof src === "string") throw new Error("expected object form");
      expect(src?.audit?.traps).toEqual(["t1", "t2"]);
    });
  });

  test("rejects empty audit.traps array (ambiguous; use true or false)", async () => {
    const yaml = `
tool:
  name: t
  description: d
docs:
  sources:
    policy:
      path: ./policy.md
      audit:
        traps: []
scenarios:
  - name: s
    prompt: p
    requiredSources: [policy]
    traps:
      - id: t1
        match: "foo"
        reason: "r"
`;
    await withTempConfig(yaml, async (dir) => {
      await expect(loadConfig(dir)).rejects.toThrow(
        /audit.traps cannot be an empty array/,
      );
    });
  });

  test("rejects audit.traps array with non-string entries", async () => {
    const yaml = `
tool:
  name: t
  description: d
docs:
  sources:
    policy:
      path: ./policy.md
      audit:
        traps: [t1, 42]
scenarios:
  - name: s
    prompt: p
    requiredSources: [policy]
    traps:
      - id: t1
        match: "foo"
        reason: "r"
`;
    await withTempConfig(yaml, async (dir) => {
      await expect(loadConfig(dir)).rejects.toThrow(
        /audit.traps\[1\] must be a string trap id/,
      );
    });
  });

  test("rejects audit.traps list with unknown trap id", async () => {
    const yaml = `
tool:
  name: t
  description: d
docs:
  sources:
    policy:
      path: ./policy.md
      audit:
        traps: [t1, ghost_trap]
scenarios:
  - name: s
    prompt: p
    requiredSources: [policy]
    traps:
      - id: t1
        match: "foo"
        reason: "r"
`;
    await withTempConfig(yaml, async (dir) => {
      await expect(loadConfig(dir)).rejects.toThrow(
        /audit.traps lists unknown trap id "ghost_trap"/,
      );
    });
  });

  test("rejects cross-scenario duplicate trap id when any source uses list form", async () => {
    const yaml = `
tool:
  name: t
  description: d
docs:
  sources:
    policy:
      path: ./policy.md
      audit:
        traps: [t_dup]
scenarios:
  - name: s1
    prompt: p
    requiredSources: [policy]
    traps:
      - id: t_dup
        match: "foo"
        reason: "r1"
  - name: s2
    prompt: p
    requiredSources: [policy]
    traps:
      - id: t_dup
        match: "bar"
        reason: "r2"
`;
    await withTempConfig(yaml, async (dir) => {
      await expect(loadConfig(dir)).rejects.toThrow(
        /trap id "t_dup" is declared in both scenario "s1" and scenario "s2"/,
      );
    });
  });

  test("accepts type: codebase with path glob and exclude list", async () => {
    const yaml = `
tool:
  name: t
  description: d
docs:
  sources:
    code:
      type: codebase
      path: "src/**/*.ts"
      exclude: ["**/*.test.ts"]
      maxBytes: 65536
scenarios:
  - name: s
    prompt: p
    requiredSources: [code]
`;
    await withTempConfig(yaml, async (dir) => {
      const cfg = await loadConfig(dir);
      const src = cfg.docs?.sources.code;
      if (typeof src === "string") throw new Error("expected object form");
      expect(src?.type).toBe("codebase");
      expect(src?.exclude).toEqual(["**/*.test.ts"]);
      expect(src?.maxBytes).toBe(65536);
    });
  });

  test("rejects type: codebase path containing '..' segments (no root escape)", async () => {
    const yaml = `
tool:
  name: t
  description: d
docs:
  sources:
    bad:
      type: codebase
      path: "../outside/**/*.ts"
scenarios:
  - name: s
    prompt: p
    requiredSources: [bad]
`;
    await withTempConfig(yaml, async (dir) => {
      await expect(loadConfig(dir)).rejects.toThrow(
        /path must not contain ".."/,
      );
    });
  });

  test("rejects exclude on non-codebase source", async () => {
    const yaml = `
tool:
  name: t
  description: d
docs:
  sources:
    bad:
      path: ./README.md
      exclude: ["foo"]
scenarios:
  - name: s
    prompt: p
    requiredSources: [bad]
`;
    await withTempConfig(yaml, async (dir) => {
      await expect(loadConfig(dir)).rejects.toThrow(
        /exclude only applies to type: codebase sources/,
      );
    });
  });

  test("rejects maxBytes on non-codebase source", async () => {
    const yaml = `
tool:
  name: t
  description: d
docs:
  sources:
    bad:
      path: ./README.md
      maxBytes: 100
scenarios:
  - name: s
    prompt: p
    requiredSources: [bad]
`;
    await withTempConfig(yaml, async (dir) => {
      await expect(loadConfig(dir)).rejects.toThrow(
        /maxBytes only applies to type: codebase sources/,
      );
    });
  });

  test("rejects unknown type value", async () => {
    const yaml = `
tool:
  name: t
  description: d
docs:
  sources:
    bad:
      type: bogus
      path: ./README.md
scenarios:
  - name: s
    prompt: p
    requiredSources: [bad]
`;
    await withTempConfig(yaml, async (dir) => {
      await expect(loadConfig(dir)).rejects.toThrow(
        /type must be "file", "url", or "codebase"/,
      );
    });
  });

  test("rejects exclude entries that are not strings", async () => {
    const yaml = `
tool:
  name: t
  description: d
docs:
  sources:
    code:
      type: codebase
      path: "src/**/*.ts"
      exclude: [42]
scenarios:
  - name: s
    prompt: p
    requiredSources: [code]
`;
    await withTempConfig(yaml, async (dir) => {
      await expect(loadConfig(dir)).rejects.toThrow(
        /exclude\[0\] must be a string glob pattern/,
      );
    });
  });

  test("rejects non-positive maxBytes", async () => {
    const yaml = `
tool:
  name: t
  description: d
docs:
  sources:
    code:
      type: codebase
      path: "src/**/*.ts"
      maxBytes: 0
scenarios:
  - name: s
    prompt: p
    requiredSources: [code]
`;
    await withTempConfig(yaml, async (dir) => {
      await expect(loadConfig(dir)).rejects.toThrow(
        /maxBytes must be a positive number/,
      );
    });
  });

  test("allows cross-scenario duplicate trap id when NO source uses list form (backward compat)", async () => {
    const yaml = `
tool:
  name: t
  description: d
docs:
  sources:
    a: ./a.md
scenarios:
  - name: s1
    prompt: p
    requiredSources: [a]
    traps:
      - id: t_dup
        match: "foo"
        reason: "r1"
  - name: s2
    prompt: p
    requiredSources: [a]
    traps:
      - id: t_dup
        match: "bar"
        reason: "r2"
`;
    await withTempConfig(yaml, async (dir) => {
      const cfg = await loadConfig(dir);
      expect(cfg.scenarios).toHaveLength(2);
    });
  });

  test("accepts Trap.auditSeverity = warning or error", async () => {
    const yaml = `
tool:
  name: t
  description: d
docs:
  sources:
    a: ./a.md
scenarios:
  - name: s
    prompt: p
    requiredSources: [a]
    traps:
      - id: t1
        match: "foo"
        reason: "r1"
        auditSeverity: warning
      - id: t2
        match: "bar"
        reason: "r2"
        auditSeverity: error
`;
    await withTempConfig(yaml, async (dir) => {
      const cfg = await loadConfig(dir);
      expect(cfg.scenarios[0]?.traps?.[0]?.auditSeverity).toBe("warning");
      expect(cfg.scenarios[0]?.traps?.[1]?.auditSeverity).toBe("error");
    });
  });

  test("rejects invalid Trap.auditSeverity", async () => {
    const yaml = `
tool:
  name: t
  description: d
docs:
  sources:
    a: ./a.md
scenarios:
  - name: s
    prompt: p
    requiredSources: [a]
    traps:
      - id: t1
        match: "foo"
        reason: "r1"
        auditSeverity: critical
`;
    await withTempConfig(yaml, async (dir) => {
      await expect(loadConfig(dir)).rejects.toThrow(
        /auditSeverity must be "warning" or "error"/,
      );
    });
  });

  test("accepts a scenario with valid traps (literal + regex)", async () => {
    const yaml = `
tool:
  name: t
  description: d
docs:
  sources:
    a: ./a.md
scenarios:
  - name: s
    prompt: p
    requiredSources: [a]
    traps:
      - id: old_schema
        match: "docs.source:"
        reason: removed schema
      - id: old_brand
        pattern: '\\\\bgone\\\\s+sour\\\\b'
        flags: i
        reason: removed language
`;
    await withTempConfig(yaml, async (dir) => {
      const cfg = await loadConfig(dir);
      expect(cfg.scenarios[0]!.traps).toHaveLength(2);
    });
  });

  test("rejects trap with both match and pattern", async () => {
    const yaml = `
tool:
  name: t
  description: d
scenarios:
  - name: s
    prompt: p
    requiredSources: []
    traps:
      - id: bad
        match: foo
        pattern: foo
        reason: r
`;
    await withTempConfig(yaml, async (dir) => {
      await expect(loadConfig(dir)).rejects.toThrow(/exactly one of/);
    });
  });

  test("rejects trap with neither match nor pattern", async () => {
    const yaml = `
tool:
  name: t
  description: d
scenarios:
  - name: s
    prompt: p
    requiredSources: []
    traps:
      - id: bad
        reason: r
`;
    await withTempConfig(yaml, async (dir) => {
      await expect(loadConfig(dir)).rejects.toThrow(/exactly one of/);
    });
  });

  test("rejects trap with flags but no pattern", async () => {
    const yaml = `
tool:
  name: t
  description: d
scenarios:
  - name: s
    prompt: p
    requiredSources: []
    traps:
      - id: bad
        match: foo
        flags: i
        reason: r
`;
    await withTempConfig(yaml, async (dir) => {
      await expect(loadConfig(dir)).rejects.toThrow(
        /'flags' without 'pattern'/,
      );
    });
  });

  test("rejects trap with forbidden regex flag g", async () => {
    const yaml = `
tool:
  name: t
  description: d
scenarios:
  - name: s
    prompt: p
    requiredSources: []
    traps:
      - id: bad
        pattern: foo
        flags: g
        reason: r
`;
    await withTempConfig(yaml, async (dir) => {
      await expect(loadConfig(dir)).rejects.toThrow(/forbidden regex flag "g"/);
    });
  });

  test("rejects trap with invalid regex", async () => {
    const yaml = `
tool:
  name: t
  description: d
scenarios:
  - name: s
    prompt: p
    requiredSources: []
    traps:
      - id: bad
        pattern: "[unterminated"
        reason: r
`;
    await withTempConfig(yaml, async (dir) => {
      await expect(loadConfig(dir)).rejects.toThrow(/invalid regex pattern/);
    });
  });

  test("rejects trap with empty match", async () => {
    const yaml = `
tool:
  name: t
  description: d
scenarios:
  - name: s
    prompt: p
    requiredSources: []
    traps:
      - id: bad
        match: ""
        reason: r
`;
    await withTempConfig(yaml, async (dir) => {
      await expect(loadConfig(dir)).rejects.toThrow(/empty 'match'/);
    });
  });

  test("rejects trap with empty pattern", async () => {
    const yaml = `
tool:
  name: t
  description: d
scenarios:
  - name: s
    prompt: p
    requiredSources: []
    traps:
      - id: bad
        pattern: ""
        reason: r
`;
    await withTempConfig(yaml, async (dir) => {
      await expect(loadConfig(dir)).rejects.toThrow(/empty 'pattern'/);
    });
  });

  test("rejects duplicate trap ids in same scenario", async () => {
    const yaml = `
tool:
  name: t
  description: d
scenarios:
  - name: s
    prompt: p
    requiredSources: []
    traps:
      - id: dup
        match: a
        reason: r1
      - id: dup
        match: b
        reason: r2
`;
    await withTempConfig(yaml, async (dir) => {
      await expect(loadConfig(dir)).rejects.toThrow(/duplicate trap id "dup"/);
    });
  });

  test("rejects codex-cli target without explicit model", async () => {
    const yaml = `
tool:
  name: t
  description: d
docs:
  sources:
    a: ./a.md
targets:
  codex:
    category: cli
    provider: codex-cli
scenarios:
  - name: s
    prompt: p
    requiredSources: []
`;
    await withTempConfig(yaml, async (dir) => {
      await expect(loadConfig(dir)).rejects.toThrow(
        /codex-cli.*requires an explicit 'model'/,
      );
    });
  });

  test("rejects codex-cli target with maxTurns", async () => {
    const yaml = `
tool:
  name: t
  description: d
targets:
  codex:
    category: cli
    provider: codex-cli
    model: gpt-5
    maxTurns: 10
scenarios:
  - name: s
    prompt: p
    requiredSources: []
`;
    await withTempConfig(yaml, async (dir) => {
      await expect(loadConfig(dir)).rejects.toThrow(
        /codex-cli.*does not support a turn cap/,
      );
    });
  });

  test("accepts codex-cli target with explicit model and no maxTurns", async () => {
    const yaml = `
tool:
  name: t
  description: d
targets:
  codex:
    category: cli
    provider: codex-cli
    model: gpt-5
scenarios:
  - name: s
    prompt: p
    requiredSources: []
`;
    await withTempConfig(yaml, async (dir) => {
      const cfg = await loadConfig(dir);
      expect(cfg.targets?.codex?.provider).toBe("codex-cli");
      expect(cfg.targets?.codex?.model).toBe("gpt-5");
    });
  });

  test("rejects API target without explicit model", async () => {
    const yaml = `
tool:
  name: t
  description: d
docs:
  sources:
    a: ./a.md
targets:
  api_no_model:
    category: api
    provider: anthropic
scenarios:
  - name: s
    prompt: p
    requiredSources: []
`;
    await withTempConfig(yaml, async (dir) => {
      await expect(loadConfig(dir)).rejects.toThrow(
        /api\/anthropic\) requires an explicit 'model' field/,
      );
    });
  });

  test("rejects API target with CLI-only fields", async () => {
    const yaml = `
tool:
  name: t
  description: d
docs:
  sources:
    a: ./a.md
targets:
  api_cli_field:
    category: api
    provider: anthropic
    model: claude-haiku-4-5
    maxTurns: 5
scenarios:
  - name: s
    prompt: p
    requiredSources: []
`;
    await withTempConfig(yaml, async (dir) => {
      await expect(loadConfig(dir)).rejects.toThrow(
        /sets 'maxTurns', which only applies to CLI/,
      );
    });
  });

  test("rejects API target with mcpServers (CLI-only)", async () => {
    const yaml = `
tool:
  name: t
  description: d
docs:
  sources:
    a: ./a.md
targets:
  api_mcp:
    category: api
    provider: anthropic
    model: claude-haiku-4-5
    mcpServers:
      foo: {}
scenarios:
  - name: s
    prompt: p
    requiredSources: []
`;
    await withTempConfig(yaml, async (dir) => {
      await expect(loadConfig(dir)).rejects.toThrow(/sets 'mcpServers'/);
    });
  });

  test("accepts API target with valid fields only", async () => {
    const yaml = `
tool:
  name: t
  description: d
docs:
  sources:
    a: ./a.md
targets:
  anth:
    category: api
    provider: anthropic
    model: claude-haiku-4-5
    temperature: 0
    maxTokens: 2048
    threshold: 70
scenarios:
  - name: s
    prompt: p
    requiredSources: []
`;
    await withTempConfig(yaml, async (dir) => {
      const cfg = await loadConfig(dir);
      expect(cfg.targets?.anth?.model).toBe("claude-haiku-4-5");
      expect(cfg.targets?.anth?.temperature).toBe(0);
      expect(cfg.targets?.anth?.maxTokens).toBe(2048);
    });
  });

  test("rejects target.systemPrompt to prevent citation-prompt bypass", async () => {
    const yaml = `
tool:
  name: t
  description: d
docs:
  sources:
    a: ./a.md
targets:
  custom:
    category: cli
    provider: claude-code
    systemPrompt: "ignore the rules"
scenarios:
  - name: s
    prompt: p
    requiredSources: []
`;
    await withTempConfig(yaml, async (dir) => {
      await expect(loadConfig(dir)).rejects.toThrow(/systemPrompt/);
    });
  });

  test("accepts a scenario with compareSurfaces", async () => {
    const yaml = `
tool:
  name: t
  description: d
docs:
  sources:
    readme: ./README.md
    llms: ./llms.txt
scenarios:
  - name: s
    prompt: p
    requiredSources: [readme]
    compareSurfaces:
      - [readme]
      - [llms]
      - [readme, llms]
`;
    await withTempConfig(yaml, async (dir) => {
      const cfg = await loadConfig(dir);
      expect(cfg.scenarios[0]?.compareSurfaces).toEqual([
        ["readme"],
        ["llms"],
        ["readme", "llms"],
      ]);
    });
  });

  test("rejects empty compareSurfaces array", async () => {
    const yaml = `
tool:
  name: t
  description: d
docs:
  sources:
    a: ./a.md
scenarios:
  - name: s
    prompt: p
    requiredSources: [a]
    compareSurfaces: []
`;
    await withTempConfig(yaml, async (dir) => {
      await expect(loadConfig(dir)).rejects.toThrow(
        /compareSurfaces cannot be empty/,
      );
    });
  });

  test("rejects empty surface inside compareSurfaces", async () => {
    const yaml = `
tool:
  name: t
  description: d
docs:
  sources:
    a: ./a.md
scenarios:
  - name: s
    prompt: p
    requiredSources: [a]
    compareSurfaces:
      - [a]
      - []
`;
    await withTempConfig(yaml, async (dir) => {
      await expect(loadConfig(dir)).rejects.toThrow(
        /compareSurfaces\[1\] must be a non-empty list/,
      );
    });
  });

  test("rejects compareSurfaces with unknown source id", async () => {
    const yaml = `
tool:
  name: t
  description: d
docs:
  sources:
    readme: ./README.md
scenarios:
  - name: s
    prompt: p
    requiredSources: [readme]
    compareSurfaces:
      - [readme]
      - [unknown_source]
`;
    await withTempConfig(yaml, async (dir) => {
      await expect(loadConfig(dir)).rejects.toThrow(
        /compareSurfaces\[1\] references unknown source "unknown_source"/,
      );
    });
  });

  test("rejects compareSurfaces that is not an array", async () => {
    const yaml = `
tool:
  name: t
  description: d
docs:
  sources:
    a: ./a.md
scenarios:
  - name: s
    prompt: p
    requiredSources: [a]
    compareSurfaces: "not an array"
`;
    await withTempConfig(yaml, async (dir) => {
      await expect(loadConfig(dir)).rejects.toThrow(
        /compareSurfaces must be an array/,
      );
    });
  });

  test("compareSurfaces is optional (backward compat with v0.10.0 scenarios)", async () => {
    const yaml = `
tool:
  name: t
  description: d
docs:
  sources:
    a: ./a.md
scenarios:
  - name: s
    prompt: p
    requiredSources: [a]
`;
    await withTempConfig(yaml, async (dir) => {
      const cfg = await loadConfig(dir);
      expect(cfg.scenarios[0]?.compareSurfaces).toBeUndefined();
    });
  });

  test("rejects matrix with non-none toolsets when only requiredSources is declared", async () => {
    // Non-none cells skip the citation contract (source is not injected).
    // requiredSources alone leaves them with no actionable answer contract:
    // the cell would otherwise default to YES because no parts are scored.
    // The loader must reject this shape and tell the user to add expected
    // or traps, or restrict toolsets to ["none"].
    const yaml = `
tool:
  name: t
  description: d
toolsets:
  none: {}
  web:
    webSearch: true
    webFetch: true
targets:
  a:
    category: cli
    provider: claude-code
docs:
  sources:
    readme: ./README.md
scenarios:
  - name: Discovery probe with only requiredSources
    prompt: p
    requiredSources: [readme]
    matrix:
      interfaces: [a]
      sources: [readme]
      toolsets: [web]
`;
    await withTempConfig(yaml, async (dir) => {
      await expect(loadConfig(dir)).rejects.toThrow(
        /non-none toolsets \[web\] but has no expected checks or traps/,
      );
    });
  });

  test("accepts matrix with non-none toolsets when expected is declared", async () => {
    const yaml = `
tool:
  name: t
  description: d
toolsets:
  none: {}
  web:
    webSearch: true
targets:
  a:
    category: cli
    provider: claude-code
docs:
  sources:
    readme: ./README.md
scenarios:
  - name: Discovery probe with expected
    prompt: p
    requiredSources: [readme]
    expected:
      includes: [pickled]
    matrix:
      interfaces: [a]
      sources: [readme]
      toolsets: [web]
`;
    await withTempConfig(yaml, async (dir) => {
      const cfg = await loadConfig(dir);
      expect(cfg.scenarios[0]?.expected?.includes).toEqual(["pickled"]);
    });
  });

  test("accepts matrix with only [none] toolset and only requiredSources", async () => {
    // None cells inject the source, so citation contract is meaningful;
    // requiredSources alone is a valid contract here.
    const yaml = `
tool:
  name: t
  description: d
toolsets:
  none: {}
targets:
  a:
    category: cli
    provider: claude-code
docs:
  sources:
    readme: ./README.md
scenarios:
  - name: Controlled probe with only requiredSources
    prompt: p
    requiredSources: [readme]
    matrix:
      interfaces: [a]
      sources: [readme]
      toolsets: [none]
`;
    await withTempConfig(yaml, async (dir) => {
      const cfg = await loadConfig(dir);
      expect(cfg.scenarios[0]?.matrix?.toolsets).toEqual(["none"]);
    });
  });

  test("expands ${VAR} in mcpServers headers from process.env", async () => {
    // Required for any MCP server that needs auth (Context7, internal docs
    // gateways). Without this, the literal string `${VAR}` would ship to
    // the MCP server and fail at the auth header layer.
    process.env.PICKLED_TEST_MCP_KEY = "secret_value_123";
    try {
      const yaml = `
tool:
  name: t
  description: d
toolsets:
  none: {}
  docs_mcp:
    mcpServers:
      docs:
        type: http
        url: https://docs.example.com/mcp
        headers:
          AUTH_TOKEN: \${PICKLED_TEST_MCP_KEY}
targets:
  a:
    category: cli
    provider: claude-code
docs:
  sources:
    readme: ./README.md
scenarios:
  - name: MCP probe
    prompt: p
    matrix:
      interfaces: [a]
      toolsets: [docs_mcp]
    expected:
      includes: [pickled]
`;
      await withTempConfig(yaml, async (dir) => {
        const cfg = await loadConfig(dir);
        expect(cfg.toolsets?.docs_mcp?.mcpServers?.docs?.headers).toEqual({
          AUTH_TOKEN: "secret_value_123",
        });
      });
    } finally {
      delete process.env.PICKLED_TEST_MCP_KEY;
    }
  });

  test("unset ${VAR} becomes empty string (failure surfaces at the call site)", async () => {
    delete process.env.PICKLED_TEST_UNSET;
    const yaml = `
tool:
  name: t
  description: d
toolsets:
  none: {}
  docs_mcp:
    mcpServers:
      docs:
        type: http
        url: https://docs.example.com/mcp
        headers:
          AUTH_TOKEN: \${PICKLED_TEST_UNSET}
targets:
  a:
    category: cli
    provider: claude-code
docs:
  sources:
    readme: ./README.md
scenarios:
  - name: MCP probe
    prompt: p
    matrix:
      interfaces: [a]
      toolsets: [docs_mcp]
    expected:
      includes: [pickled]
`;
    await withTempConfig(yaml, async (dir) => {
      const cfg = await loadConfig(dir);
      expect(cfg.toolsets?.docs_mcp?.mcpServers?.docs?.headers).toEqual({
        AUTH_TOKEN: "",
      });
    });
  });

  test("strings without ${...} are unchanged (no over-match)", async () => {
    const yaml = `
tool:
  name: t
  description: d
docs:
  sources:
    readme: ./README.md
scenarios:
  - name: Plain probe
    prompt: "Does pickled support \${ as a literal? No braces here."
    requiredSources: [readme]
`;
    await withTempConfig(yaml, async (dir) => {
      const cfg = await loadConfig(dir);
      // Lone "$" without "{NAME}" stays as-is. Only the strict
      // /\$\{[A-Z_][A-Z0-9_]*\}/ shape is expanded.
      expect(cfg.scenarios[0]?.prompt).toContain("${");
    });
  });

  test("rejects 'none' as a docs.sources id (reserved no-context sentinel)", async () => {
    const yaml = `
tool:
  name: t
  description: d
docs:
  sources:
    none: ./README.md
scenarios:
  - name: s
    prompt: p
    requiredSources: [none]
`;
    await withTempConfig(yaml, async (dir) => {
      await expect(loadConfig(dir)).rejects.toThrow(
        /docs\.sources cannot use the reserved id "none"/,
      );
    });
  });

  test("accepts 'none' in matrix.sources without it being a registered source", async () => {
    // "none" is the no-context sentinel; the loader must accept it
    // alongside registered source ids in the matrix.sources axis.
    const yaml = `
tool:
  name: t
  description: d
targets:
  a:
    category: cli
    provider: claude-code
docs:
  sources:
    readme: ./README.md
scenarios:
  - name: Baseline + injected
    prompt: p
    matrix:
      interfaces: [a]
      sources: [none, readme]
      toolsets: [none]
    expected:
      includes: [pickled]
`;
    await withTempConfig(yaml, async (dir) => {
      const cfg = await loadConfig(dir);
      expect(cfg.scenarios[0]?.matrix?.sources).toEqual(["none", "readme"]);
    });
  });

  describe("actionable-contract gate honors grouped expected keys", () => {
    test("symbols-only scenario is accepted (regression for grouped-only gate)", async () => {
      const yaml = `
tool:
  name: t
  description: d
scenarios:
  - name: SymbolsOnly
    prompt: p
    expected:
      symbols: ["Matrix"]
`;
      await withTempConfig(yaml, async (dir) => {
        const cfg = await loadConfig(dir);
        expect(cfg.scenarios[0]!.expected?.symbols).toEqual(["Matrix"]);
      });
    });

    test("each grouped-only key (paths/options/constraints) is also accepted", async () => {
      for (const field of ["paths", "options", "constraints"] as const) {
        const yaml = `
tool:
  name: t
  description: d
scenarios:
  - name: GroupedOnly
    prompt: p
    expected:
      ${field}: ["value"]
`;
        await withTempConfig(yaml, async (dir) => {
          const cfg = await loadConfig(dir);
          expect(cfg.scenarios[0]!.expected?.[field]).toEqual(["value"]);
        });
      }
    });

    test("scenario with no actionable contract at all still rejects", async () => {
      const yaml = `
tool:
  name: t
  description: d
scenarios:
  - name: Empty
    prompt: p
`;
      await withTempConfig(yaml, async (dir) => {
        // Error message now mentions grouped keys, not just includes/excludes.
        await expect(loadConfig(dir)).rejects.toThrow(
          /symbols\/paths\/options\/constraints/,
        );
      });
    });

    test("non-none toolset cell with only grouped expected is accepted (matrix gate)", async () => {
      const yaml = `
tool:
  name: t
  description: d
docs:
  sources:
    readme: ./README.md
toolsets:
  none: {}
  web:
    webSearch: true
targets:
  q:
    category: cli
    provider: claude-code
scenarios:
  - name: WebCellGroupedOnly
    prompt: p
    matrix:
      interfaces: [q]
      sources: [readme]
      toolsets: [web]
    expected:
      symbols: ["registerToolbarButton"]
`;
      await withTempConfig(yaml, async (dir) => {
        const cfg = await loadConfig(dir);
        expect(cfg.scenarios[0]!.matrix?.toolsets).toEqual(["web"]);
        expect(cfg.scenarios[0]!.expected?.symbols).toEqual([
          "registerToolbarButton",
        ]);
      });
    });
  });
});
