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

describe("loader: docs.sources maxBytes hard ceiling", () => {
  test("rejects maxBytes greater than 4 MB", async () => {
    const dir = makeDir(`
tool: { name: t, description: d }
docs:
  sources:
    code:
      path: "src/**/*.ts"
      type: codebase
      maxBytes: 5242880
scenarios:
  - name: s
    prompt: p
    requiredSources: [code]
`);
    await expect(loadConfig(dir)).rejects.toThrow(
      /exceeds the 4 MB hard ceiling/,
    );
  });

  test("accepts maxBytes equal to 4 MB", async () => {
    const dir = makeDir(`
tool: { name: t, description: d }
docs:
  sources:
    code:
      path: "src/**/*.ts"
      type: codebase
      maxBytes: 4194304
scenarios:
  - name: s
    prompt: p
    requiredSources: [code]
`);
    await expect(loadConfig(dir)).resolves.toBeDefined();
  });
});

describe("loader: unknown scenario.target / scenario.context", () => {
  test("rejects scenario.target that is not in declared targets", async () => {
    const dir = makeDir(`
tool: { name: t, description: d }
targets:
  quick: { category: cli, provider: claude-code }
scenarios:
  - name: s
    prompt: p
    target: nonexistent
    requiredSources: []
`);
    await expect(loadConfig(dir)).rejects.toThrow(
      /scenario "s" references unknown target "nonexistent"/,
    );
  });

  test("accepts scenario.target that resolves", async () => {
    const dir = makeDir(`
tool: { name: t, description: d }
targets:
  quick: { category: cli, provider: claude-code }
scenarios:
  - name: s
    prompt: p
    target: quick
    requiredSources: []
`);
    await expect(loadConfig(dir)).resolves.toBeDefined();
  });

  test("accepts omitted scenario.target (zero-config default)", async () => {
    const dir = makeDir(`
tool: { name: t, description: d }
scenarios:
  - name: s
    prompt: p
    requiredSources: []
`);
    await expect(loadConfig(dir)).resolves.toBeDefined();
  });

  test('accepts scenario.target: "default"', async () => {
    const dir = makeDir(`
tool: { name: t, description: d }
scenarios:
  - name: s
    prompt: p
    target: default
    requiredSources: []
`);
    await expect(loadConfig(dir)).resolves.toBeDefined();
  });

  test("rejects scenario.context that is not in declared contexts", async () => {
    const dir = makeDir(`
tool: { name: t, description: d }
contexts:
  ide: { allowedTools: ["Read"] }
scenarios:
  - name: s
    prompt: p
    context: nonexistent
    requiredSources: []
`);
    await expect(loadConfig(dir)).rejects.toThrow(
      /scenario "s" references unknown context "nonexistent"/,
    );
  });

  test("accepts scenario.context that resolves", async () => {
    const dir = makeDir(`
tool: { name: t, description: d }
contexts:
  ide: { allowedTools: ["Read"] }
scenarios:
  - name: s
    prompt: p
    context: ide
    requiredSources: []
`);
    await expect(loadConfig(dir)).resolves.toBeDefined();
  });
});

describe("loader: top-level matrix.target / matrix.context refs", () => {
  test("rejects matrix.target entries that are not in declared targets", async () => {
    const dir = makeDir(`
tool: { name: t, description: d }
targets:
  quick: { category: cli, provider: claude-code }
matrix:
  target: [quick, nonexistent]
scenarios:
  - name: s
    prompt: p
    requiredSources: []
`);
    await expect(loadConfig(dir)).rejects.toThrow(
      /matrix\.target references unknown target "nonexistent"/,
    );
  });

  test("rejects matrix.context entries that are not in declared contexts", async () => {
    const dir = makeDir(`
tool: { name: t, description: d }
contexts:
  ide: { allowedTools: ["Read"] }
matrix:
  context: [ide, nonexistent]
scenarios:
  - name: s
    prompt: p
    requiredSources: []
`);
    await expect(loadConfig(dir)).rejects.toThrow(
      /matrix\.context references unknown context "nonexistent"/,
    );
  });

  test('accepts "default" sentinel in matrix.target', async () => {
    const dir = makeDir(`
tool: { name: t, description: d }
targets:
  quick: { category: cli, provider: claude-code }
matrix:
  target: [quick, default]
scenarios:
  - name: s
    prompt: p
    requiredSources: []
`);
    await expect(loadConfig(dir)).resolves.toBeDefined();
  });

  test("rejects matrix.target as a bare string (not an array)", async () => {
    const dir = makeDir(`
tool: { name: t, description: d }
targets:
  quick: { category: cli, provider: claude-code }
matrix:
  target: quick
scenarios:
  - name: s
    prompt: p
    requiredSources: []
`);
    await expect(loadConfig(dir)).rejects.toThrow(
      /matrix\.target must be an array/,
    );
  });

  test("rejects matrix.context as a bare string (not an array)", async () => {
    const dir = makeDir(`
tool: { name: t, description: d }
contexts:
  ide: { allowedTools: ["Read"] }
matrix:
  context: ide
scenarios:
  - name: s
    prompt: p
    requiredSources: []
`);
    await expect(loadConfig(dir)).rejects.toThrow(
      /matrix\.context must be an array/,
    );
  });
});
