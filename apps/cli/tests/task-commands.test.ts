import { afterEach, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build, verifyOnlyMisusedFlags } from "../src/commands/build.js";
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

/** Capture stdout (--json) + console.log (human output) for one call. */
async function capture(fn: () => Promise<void>): Promise<string> {
  const chunks: string[] = [];
  const origWrite = process.stdout.write.bind(process.stdout);
  const origLog = console.log.bind(console);
  // biome-ignore lint/suspicious/noExplicitAny: test spy
  process.stdout.write = ((s: any, enc?: any, cb?: any) => {
    chunks.push(String(s));
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
schemaVersion: 2
product: { name: my-product, description: a tool }
agents:
  builder: { provider: claude-code, model: m }
contexts:
  mem: { mode: memory }
facts:
  inst: { statement: install, match: { allOf: ["bunx"] } }
questions:
  - id: install
    question: How do I install?
    agents: [builder]
    contexts: [mem]
    expects: [inst]
builds:
  - id: toolbar
    goal: Add a toolbar.
    agents: [builder]
    contexts: [mem]
    trials: 3
    workspace: { path: ./fixtures/app }
    verifier:
      failToPass: [{ run: bun test }]
`;

const QUESTIONS_ONLY = `
schemaVersion: 2
product: { name: p, description: d }
agents: { builder: { provider: claude-code, model: m } }
contexts: { mem: { mode: memory } }
facts: { inst: { statement: install, match: { allOf: ["bunx"] } } }
questions:
  - id: install
    question: How?
    agents: [builder]
    contexts: [mem]
    expects: [inst]
`;

describe("pickled check / build task routing", () => {
  test("check --plan includes only questions", async () => {
    const dir = project(MIXED);
    const out = await capture(() => check(dir, { plan: true, json: true }));
    const names = JSON.parse(out).plan.cells.map(
      (c: { task: string }) => c.task,
    );
    expect(names).toContain("install");
    expect(names).not.toContain("toolbar");
  });

  test("build --plan includes only builds, with trial-expanded executions", async () => {
    const dir = project(MIXED);
    const out = await capture(() => build(dir, { plan: true, json: true }));
    const plan = JSON.parse(out).plan;
    expect(plan.cells.map((c: { task: string }) => c.task)).toEqual([
      "toolbar",
    ]);
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
    expect(clean).toContain("Executions: 3");
    expect(clean).not.toContain("pickled check");
  });

  test("--task narrows to the named task", async () => {
    const dir = project(MIXED);
    const out = await capture(() =>
      check(dir, { plan: true, json: true, task: "install" }),
    );
    const names = JSON.parse(out).plan.cells.map(
      (c: { task: string }) => c.task,
    );
    expect(names).toEqual(["install"]);
  });

  test("build on a questions-only config says nothing to run (human)", async () => {
    const dir = project(QUESTIONS_ONLY);
    const out = await capture(() => build(dir, {}));
    expect(out).toContain("No builds");
    expect(out).toContain("pickled check");
  });

  test("build --json on a questions-only config emits a valid empty builds report", async () => {
    const dir = project(QUESTIONS_ONLY);
    const out = await capture(() => build(dir, { json: true }));
    const report = JSON.parse(out);
    expect(report.kind).toBe("builds");
    expect(report.builds).toEqual([]);
    expect(report.summary).toMatchObject({ total: 0, yes: 0, errors: 0 });
  });

  test("--verify-only on a questions-only config says nothing to prove", async () => {
    const dir = project(QUESTIONS_ONLY);
    const out = await capture(() => build(dir, { verifyOnly: true }));
    expect(out).toContain("Nothing to prove");
  });

  test("--verify-only proves each build's harness without running an agent", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pickled-cli-"));
    created.push(dir);
    const ws = join(dir, "ws");
    mkdirSync(ws, { recursive: true });
    writeFileSync(join(ws, "placeholder.txt"), "x\n");
    writeFileSync(
      join(dir, "pickled.yml"),
      `
schemaVersion: 2
product: { name: my-product, description: a tool }
agents: { builder: { provider: claude-code, model: m } }
contexts: { mem: { mode: memory } }
builds:
  - id: widget
    goal: Add a widget.
    agents: [builder]
    contexts: [mem]
    workspace: { path: "${ws}" }
    verifier:
      failToPass: [{ run: "grep -q ok answer.txt" }]
`,
    );
    const out = await capture(() => build(dir, { verifyOnly: true }));
    const stripAnsi = (s: string) =>
      s.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g"), "");
    const clean = stripAnsi(out);
    expect(clean).toContain("Build verifier proof: 1");
    expect(clean).toContain("widget");
    // No reference solution declared, so the harness is honestly unproven.
    expect(clean).toContain("unproven");
  });

  test("--verify-only --output writes the proof results as JSON", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pickled-cli-"));
    created.push(dir);
    const ws = join(dir, "ws");
    mkdirSync(ws, { recursive: true });
    writeFileSync(join(ws, "placeholder.txt"), "x\n");
    writeFileSync(
      join(dir, "pickled.yml"),
      `
schemaVersion: 2
product: { name: my-product, description: a tool }
agents: { builder: { provider: claude-code, model: m } }
contexts: { mem: { mode: memory } }
builds:
  - id: widget
    goal: Add a widget.
    agents: [builder]
    contexts: [mem]
    workspace: { path: "${ws}" }
    verifier:
      failToPass: [{ run: "grep -q ok answer.txt" }]
`,
    );
    const outFile = join(dir, "proof.json");
    await capture(() => build(dir, { verifyOnly: true, output: outFile }));
    const saved = JSON.parse(readFileSync(outFile, "utf8"));
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ id: "widget", status: "unproven" });
  });
});

describe("verifyOnlyMisusedFlags", () => {
  test("flags agent/context/sampling/threshold/plan/keep-on-failure as misuse", () => {
    expect(
      verifyOnlyMisusedFlags({
        agent: "a",
        context: "c",
        sample: "2",
        seed: "s",
        maxCells: "5",
        threshold: "80",
        plan: true,
        keepOnFailure: true,
      }).sort(),
    ).toEqual(
      [
        "--agent",
        "--context",
        "--keep-on-failure",
        "--max-cells",
        "--plan",
        "--sample",
        "--seed",
        "--threshold",
      ].sort(),
    );
  });

  test("allows --task, --json, --output, --verbose (no misuse)", () => {
    expect(
      verifyOnlyMisusedFlags({
        task: "t",
        json: true,
        output: "f",
        verbose: true,
      }),
    ).toEqual([]);
  });
});
