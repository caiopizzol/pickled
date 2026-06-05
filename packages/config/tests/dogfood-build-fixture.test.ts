import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "../../..");
const FIXTURE = join(REPO_ROOT, "fixtures/github-actions");
const PATCH = join(REPO_ROOT, "fixtures/github-actions.solution.patch");

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
  return spawnSync("bash", ["./tests/verify-workflow.sh"], {
    cwd,
    encoding: "utf8",
  });
}

describe("build dogfood fixture", () => {
  test("the verifier lives under tests so build-mode harness protection covers it", () => {
    expect(existsSync(join(FIXTURE, "tests", "verify-workflow.sh"))).toBe(true);
  });

  test("the untouched fixture fails verification", () => {
    const dir = copyFixture();
    const result = runVerifier(dir);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("missing .github/workflows/pickled.yml");
  });

  test("the reference workflow patch passes verification", () => {
    const dir = copyFixture();
    const apply = spawnSync("git", ["apply", PATCH], {
      cwd: dir,
      encoding: "utf8",
    });
    expect(apply.stderr).toBe("");
    expect(apply.status).toBe(0);

    const result = runVerifier(dir);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });

  test("semantic workflow shape passes even when job names differ", () => {
    const dir = copyFixture();
    mkdirSync(join(dir, ".github", "workflows"), { recursive: true });
    writeFileSync(
      join(dir, ".github", "workflows", "pickled.yml"),
      `name: pickled

on:
  pull_request:
  workflow_dispatch:
  schedule:
    - cron: "17 8 * * 1"

jobs:
  dry-run:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: oven-sh/setup-bun@v2
      - run: bun install
      - run: bunx @pickled-dev/cli test .
      - run: bunx @pickled-dev/cli check . --plan
      - run: bunx @pickled-dev/cli build . --plan

  paid:
    runs-on: ubuntu-latest
    if: github.event_name == 'workflow_dispatch' || github.event_name == 'schedule'
    steps:
      - uses: actions/checkout@v6
      - uses: oven-sh/setup-bun@v2
      - run: bun install
      - run: bunx @pickled-dev/cli check . --max-cells 20
        env:
          ANTHROPIC_API_KEY: \${{ secrets.ANTHROPIC_API_KEY }}
      - run: bunx @pickled-dev/cli build . --max-cells 6
        env:
          ANTHROPIC_API_KEY: \${{ secrets.ANTHROPIC_API_KEY }}
`,
    );
    const result = runVerifier(dir);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });

  test("manual-only real agent runs pass verification", () => {
    const dir = copyFixture();
    mkdirSync(join(dir, ".github", "workflows"), { recursive: true });
    writeFileSync(
      join(dir, ".github", "workflows", "pickled.yml"),
      `name: pickled

on:
  pull_request:
  workflow_dispatch:

jobs:
  deterministic:
    runs-on: ubuntu-latest
    steps:
      - run: bunx @pickled-dev/cli test .
      - run: bunx @pickled-dev/cli check . --plan
      - run: bunx @pickled-dev/cli build . --plan

  real-agents:
    runs-on: ubuntu-latest
    if: github.event_name == 'workflow_dispatch'
    steps:
      - run: bunx @pickled-dev/cli check . --max-cells 20
        env:
          ANTHROPIC_API_KEY: \${{ secrets.ANTHROPIC_API_KEY }}
      - run: bunx @pickled-dev/cli build . --max-cells 6
        env:
          ANTHROPIC_API_KEY: \${{ secrets.ANTHROPIC_API_KEY }}
`,
    );
    const result = runVerifier(dir);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });

  test("non-pull-request real agent gate passes verification", () => {
    const dir = copyFixture();
    mkdirSync(join(dir, ".github", "workflows"), { recursive: true });
    writeFileSync(
      join(dir, ".github", "workflows", "pickled.yml"),
      `name: pickled

on:
  pull_request:
  workflow_dispatch:
  schedule:
    - cron: "17 8 * * 1"

jobs:
  deterministic:
    runs-on: ubuntu-latest
    steps:
      - run: bunx @pickled-dev/cli test .
      - run: bunx @pickled-dev/cli check . --plan
      - run: bunx @pickled-dev/cli build . --plan

  real-agents:
    runs-on: ubuntu-latest
    if: github.event_name != 'pull_request'
    steps:
      - run: bunx @pickled-dev/cli check . --max-cells 20
        env:
          ANTHROPIC_API_KEY: \${{ secrets.ANTHROPIC_API_KEY }}
      - run: bunx @pickled-dev/cli build . --max-cells 6
        env:
          ANTHROPIC_API_KEY: \${{ secrets.ANTHROPIC_API_KEY }}
`,
    );
    const result = runVerifier(dir);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });

  test("pull_request_target is rejected", () => {
    const dir = copyFixture();
    mkdirSync(join(dir, ".github", "workflows"), { recursive: true });
    writeFileSync(
      join(dir, ".github", "workflows", "pickled.yml"),
      `name: pickled

on:
  pull_request_target:

jobs:
  unsafe:
    runs-on: ubuntu-latest
    steps:
      - run: bunx @pickled-dev/cli check . --max-cells 20
        env:
          ANTHROPIC_API_KEY: \${{ secrets.ANTHROPIC_API_KEY }}
`,
    );
    const result = runVerifier(dir);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("pull_request_target is not allowed");
  });
});
