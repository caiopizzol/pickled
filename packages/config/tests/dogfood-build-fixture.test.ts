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

  test("semantic access paths pass even when names differ", () => {
    const dir = copyFixture();
    writeFileSync(
      join(dir, "pickled.yml"),
      `product:
  name: BrineKit
  description: CLI fixture for Pickled config authoring

sources:
  llms: ./llms.txt

agents:
  quick:
    provider: claude-code
    model: claude-haiku-4-5

access:
  memory_only: { source: none, tools: none }
  with_llms_context: { source: llms, tools: none }

tasks:
  - id: install
    prompt: How do I install BrineKit?
    agents: [quick]
    access: [memory_only, with_llms_context]
    checks:
      mustMention: ["bunx brinekit init"]
      mustNotMention: ["npm install brinekit"]

  - id: smoke_build
    kind: build
    prompt: Create configured.txt in the BrineKit workspace.
    agents: [quick]
    access: [with_llms_context]
    trials: 2
    workspace:
      path: ./workspace
    verify:
      - test -f configured.txt
`,
    );
    const result = runVerifier(dir);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });
});
