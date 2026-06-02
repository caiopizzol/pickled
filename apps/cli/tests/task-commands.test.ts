import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "../src/commands/build.js";
import { check } from "../src/commands/check.js";

const created: string[] = [];
afterEach(() => {
  for (const d of created.splice(0))
    rmSync(d, { recursive: true, force: true });
});

function project(yml: string): string {
  const dir = mkdtempSync(join(tmpdir(), "pickled-cli-"));
  created.push(dir);
  writeFileSync(join(dir, "pickled.yml"), yml);
  return dir;
}

// Capture stdout (--json plan) + console.log (nothing-to-run) for one call.
async function capture(fn: () => Promise<void>): Promise<string> {
  const chunks: string[] = [];
  const origWrite = process.stdout.write.bind(process.stdout);
  const origLog = console.log.bind(console);
  // biome-ignore lint/suspicious/noExplicitAny: test spy
  process.stdout.write = ((s: any, enc?: any, cb?: any) => {
    chunks.push(String(s));
    // writeStdout awaits the write callback; invoke it so it resolves.
    const done = typeof enc === "function" ? enc : cb;
    if (typeof done === "function") done();
    return true;
  }) as typeof process.stdout.write;
  console.log = (...args: unknown[]) => {
    chunks.push(args.join(" "));
  };
  try {
    await fn();
  } finally {
    process.stdout.write = origWrite;
    console.log = origLog;
  }
  return chunks.join("\n");
}

const MIXED = `
product: { name: my-product, description: a tool }
agents:
  builder: { provider: claude-code, model: m }
access:
  memory: { source: none, tools: none }
tasks:
  - id: install
    prompt: How do I install?
    agents: [builder]
    access: [memory]
    checks: { mustMention: ["bunx"] }
  - id: toolbar
    kind: build
    prompt: Add a toolbar.
    agents: [builder]
    access: [memory]
    trials: 3
    workspace: { path: ./fixtures/app }
    verify: [bun test]
`;

describe("pickled check / build task routing", () => {
  test("check --plan includes only answer tasks", async () => {
    const dir = project(MIXED);
    const out = await capture(() => check(dir, { plan: true, json: true }));
    const plan = JSON.parse(out).plan;
    const names = plan.cells.map((c: { scenario: string }) => c.scenario);
    expect(names).toContain("install");
    expect(names).not.toContain("toolbar");
  });

  test("build --plan includes only build tasks, with trial-expanded executions", async () => {
    const dir = project(MIXED);
    const out = await capture(() => build(dir, { plan: true, json: true }));
    const plan = JSON.parse(out).plan;
    const names = plan.cells.map((c: { scenario: string }) => c.scenario);
    expect(names).toEqual(["toolbar"]);
    expect(plan.selectedCells).toBe(1);
    expect(plan.selectedExecutions).toBe(3); // 1 cell x trials 3
  });

  test("build --plan terminal view names the command and shows executions", async () => {
    const dir = project(MIXED);
    const out = await capture(() => build(dir, { plan: true }));
    const stripAnsi = (s: string) =>
      s.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g"), "");
    const clean = stripAnsi(out);
    expect(clean).toContain("pickled build");
    expect(clean).toContain("Tasks:");
    expect(clean).toContain("Executions: 3"); // 1 cell x trials 3
    expect(clean).not.toContain("pickled check");
    expect(clean).not.toContain("Questions:");
  });

  test("--task narrows to the named task", async () => {
    const dir = project(MIXED);
    const out = await capture(() =>
      check(dir, { plan: true, json: true, task: "install" }),
    );
    const names = JSON.parse(out).plan.cells.map(
      (c: { scenario: string }) => c.scenario,
    );
    expect(names).toEqual(["install"]);
  });

  test("build on an answer-only config says nothing to run (no throw)", async () => {
    const answerOnly = `
product: { name: p, description: d }
agents: { builder: { provider: claude-code, model: m } }
access: { memory: { source: none, tools: none } }
tasks:
  - id: install
    prompt: How?
    agents: [builder]
    access: [memory]
    checks: { mustMention: ["bunx"] }
`;
    const dir = project(answerOnly);
    const out = await capture(() => build(dir, {}));
    expect(out).toContain("No build tasks");
    expect(out).toContain("pickled check");
  });
});
