import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanSourceTraps } from "../../src/audit/source-traps.js";

const created: string[] = [];

afterEach(() => {
  for (const d of created.splice(0)) {
    rmSync(d, { recursive: true, force: true });
  }
});

function makeRepo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "pickled-audit-src-traps-"));
  created.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    writeFileSync(join(dir, rel), content);
  }
  return dir;
}

describe("scanSourceTraps", () => {
  test("returns empty when no pickled.yml is present", async () => {
    const dir = makeRepo({ "README.md": "hello" });
    const result = await scanSourceTraps(dir);
    expect(result.matches).toHaveLength(0);
    expect(result.findings).toHaveLength(0);
  });

  test("returns empty when docs.sources is empty", async () => {
    const dir = makeRepo({
      "pickled.yml": `
tool:
  name: t
  description: d
scenarios:
  - name: s
    prompt: p
    requiredSources: []
`,
    });
    const result = await scanSourceTraps(dir);
    expect(result.matches).toHaveLength(0);
    expect(result.findings).toHaveLength(0);
  });

  test("returns empty when no scenarios declare traps", async () => {
    const dir = makeRepo({
      "README.md": "any content",
      "pickled.yml": `
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
`,
    });
    const result = await scanSourceTraps(dir);
    expect(result.matches).toHaveLength(0);
    expect(result.findings).toHaveLength(0);
  });

  test("matches a trap pattern in a registered source and computes line number", async () => {
    const dir = makeRepo({
      "README.md": "Line one.\nLine two has docs.source: in it.\nLine three.",
      "pickled.yml": `
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
    traps:
      - id: old_schema
        match: "docs.source:"
        reason: "Removed singular schema"
`,
    });
    const { matches, findings } = await scanSourceTraps(dir);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      sourceId: "readme",
      trapId: "old_schema",
      matched: "docs.source:",
      line: 2,
      severity: "warning",
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: "warning",
      category: "trap-source-match",
      file: "./README.md",
    });
    expect(findings[0]!.message).toContain("readme");
    expect(findings[0]!.message).toContain("old_schema");
    expect(findings[0]!.message).toContain("audit.traps: false");
  });

  test("auditSeverity: error escalates the finding severity", async () => {
    const dir = makeRepo({
      "README.md": "this README contains the banned phrase docs.source: here.",
      "pickled.yml": `
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
    traps:
      - id: old_schema
        match: "docs.source:"
        reason: "Removed singular schema"
        auditSeverity: error
`,
    });
    const { matches, findings } = await scanSourceTraps(dir);
    expect(matches[0]?.severity).toBe("error");
    expect(findings[0]?.severity).toBe("error");
  });

  test("audit.traps: false skips a source entirely", async () => {
    const dir = makeRepo({
      "README.md": "clean source.",
      "stale.md": "this is docs.source: a banned phrase.",
      "pickled.yml": `
tool:
  name: t
  description: d
docs:
  sources:
    readme: ./README.md
    stale:
      path: ./stale.md
      audit:
        traps: false
scenarios:
  - name: s
    prompt: p
    requiredSources: [readme]
    traps:
      - id: old_schema
        match: "docs.source:"
        reason: "Removed singular schema"
`,
    });
    const { matches } = await scanSourceTraps(dir);
    expect(matches).toHaveLength(0);
  });

  test("scans all traps across all scenarios", async () => {
    const dir = makeRepo({
      "README.md": "old docs.source: usage and freshness score branding.",
      "pickled.yml": `
tool:
  name: t
  description: d
docs:
  sources:
    readme: ./README.md
scenarios:
  - name: s1
    prompt: p
    requiredSources: [readme]
    traps:
      - id: t1
        match: "docs.source:"
        reason: "r1"
  - name: s2
    prompt: p
    requiredSources: [readme]
    traps:
      - id: t2
        match: "freshness score"
        reason: "r2"
`,
    });
    const { matches } = await scanSourceTraps(dir);
    expect(matches).toHaveLength(2);
    const ids = matches.map((m) => m.trapId).sort();
    expect(ids).toEqual(["t1", "t2"]);
  });

  test("skips URL sources in v1 (audit stays local)", async () => {
    const dir = makeRepo({
      "README.md": "this README contains docs.source: a banned phrase.",
      "pickled.yml": `
tool:
  name: t
  description: d
docs:
  sources:
    readme: ./README.md
    remote: https://example.com/docs.md
scenarios:
  - name: s
    prompt: p
    requiredSources: [readme]
    traps:
      - id: old_schema
        match: "docs.source:"
        reason: "Removed singular schema"
`,
    });
    const { matches } = await scanSourceTraps(dir);
    // Only readme is scanned. The URL source is silently skipped (no fetch).
    expect(matches).toHaveLength(1);
    expect(matches[0]?.sourceId).toBe("readme");
  });

  test("returns empty when every source is a URL", async () => {
    const dir = makeRepo({
      "pickled.yml": `
tool:
  name: t
  description: d
docs:
  sources:
    remote: https://example.com/docs.md
scenarios:
  - name: s
    prompt: p
    requiredSources: [remote]
    traps:
      - id: x
        match: "anything"
        reason: "r"
`,
    });
    const { matches, findings } = await scanSourceTraps(dir);
    expect(matches).toHaveLength(0);
    expect(findings).toHaveLength(0);
  });

  test("treats same-id traps in different scenarios independently for severity", async () => {
    const dir = makeRepo({
      "README.md": "this README contains docs.source: in it.",
      "pickled.yml": `
tool:
  name: t
  description: d
docs:
  sources:
    readme: ./README.md
scenarios:
  - name: s1
    prompt: p
    requiredSources: [readme]
    traps:
      - id: dup
        match: "docs.source:"
        reason: "r warning"
        auditSeverity: warning
  - name: s2
    prompt: p
    requiredSources: [readme]
    traps:
      - id: dup
        match: "docs.source:"
        reason: "r error"
        auditSeverity: error
`,
    });
    const { matches } = await scanSourceTraps(dir);
    expect(matches).toHaveLength(2);
    const severities = matches.map((m) => m.severity).sort();
    expect(severities).toEqual(["error", "warning"]);
  });

  test("produces accurate line numbers for matches on different lines", async () => {
    const lines: string[] = [];
    for (let i = 1; i <= 50; i++) lines.push(`line ${i}`);
    lines[24] = "this line has docs.source: in it";
    const dir = makeRepo({
      "README.md": lines.join("\n"),
      "pickled.yml": `
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
    traps:
      - id: old_schema
        match: "docs.source:"
        reason: "Removed singular schema"
`,
    });
    const { matches } = await scanSourceTraps(dir);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.line).toBe(25);
  });
});
