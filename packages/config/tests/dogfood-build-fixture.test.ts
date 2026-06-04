import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "../../..");
const FIXTURE = join(REPO_ROOT, "fixtures/pickled-config-authoring");
const GOLDEN = join(REPO_ROOT, "fixtures/pickled-config-authoring.golden");
const LOCAL_CLI = `bun ${join(REPO_ROOT, "apps/cli/src/index.ts")}`;

const created: string[] = [];
afterEach(() => {
  for (const d of created.splice(0))
    rmSync(d, { recursive: true, force: true });
});

function copyFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "pickled-dogfood-build-"));
  created.push(dir);
  cpSync(FIXTURE, dir, { recursive: true });
  return dir;
}

function runVerifier(cwd: string) {
  return spawnSync("bash", ["./tests/verify-pickled-config.sh"], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, PICKLED_CLI: LOCAL_CLI },
  });
}

describe("build dogfood fixture", () => {
  test("the verifier lives under tests so build-mode harness protection covers it", () => {
    expect(existsSync(join(FIXTURE, "tests", "verify-pickled-config.sh"))).toBe(
      true,
    );
  });

  test("the untouched fixture fails verification", () => {
    const dir = copyFixture();
    const result = runVerifier(dir);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("missing pickled.yml");
  });

  test("the golden config passes verification", () => {
    const dir = copyFixture();
    cpSync(join(GOLDEN, "pickled.yml"), join(dir, "pickled.yml"));
    const result = runVerifier(dir);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });

  test("semantic context paths pass even when names differ", () => {
    const dir = copyFixture();
    writeFileSync(
      join(dir, "pickled.yml"),
      `schemaVersion: 2

product:
  name: BrineKit
  description: CLI fixture for Pickled config authoring

sources:
  llms: { path: ./llms.txt }

agents:
  quick:
    provider: claude-code
    model: claude-haiku-4-5

contexts:
  memory_only: { mode: memory }
  with_llms_context: { mode: inject, source: llms }

facts:
  install_command:
    statement: BrineKit installs with bunx brinekit init.
    match:
      allOf: ["bunx brinekit init"]

misstatements:
  npm_install:
    statement: Recommends npm install for BrineKit.
    match:
      anyOf: ["npm install brinekit"]

questions:
  - id: install
    question: How do I install BrineKit?
    agents: [quick]
    contexts: [memory_only, with_llms_context]
    expects: [install_command]
    rejects: [npm_install]
    examples:
      pass: ["Install with bunx brinekit init."]
      fail: ["Install with npm install brinekit."]

builds:
  - id: smoke_build
    goal: Create configured.txt in the BrineKit workspace.
    agents: [quick]
    contexts: [with_llms_context]
    trials: 2
    workspace:
      path: ./workspace
    verifier:
      failToPass:
        - { run: test -f configured.txt }
`,
    );
    const result = runVerifier(dir);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });
});
