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

  test("rejects non-string docs.sources values", async () => {
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
        /docs.sources\["bad"\] must be a non-empty string/,
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
        /must be a non-empty string/,
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
});
