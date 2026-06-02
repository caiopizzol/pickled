import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkDiff,
  type DiffChecks,
  runCommands,
} from "../../src/implement/verifiers.js";
import {
  createWorkspace,
  type WorkspaceDiff,
} from "../../src/implement/workspace.js";

const created: string[] = [];
afterEach(() => {
  for (const d of created.splice(0))
    rmSync(d, { recursive: true, force: true });
});

function fixtureDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "pickled-fixture-"));
  created.push(dir);
  writeFileSync(join(dir, "a.txt"), "hi\n");
  return dir;
}

describe("command verifier", () => {
  test("passes on exit 0, fails on non-zero, captures stdout", async () => {
    const ws = await createWorkspace(fixtureDir());
    created.push(ws.dir);
    const results = await runCommands(ws, [
      { name: "ok", run: "true" },
      { name: "fail", run: "exit 2" },
      { name: "echo", run: "echo hello" },
    ]);
    expect(results.map((r) => [r.name, r.passed, r.exitCode])).toEqual([
      ["ok", true, 0],
      ["fail", false, 2],
      ["echo", true, 0],
    ]);
    expect(results[2]?.stdout).toContain("hello");
  });
});

const ADDED_IMPORT: WorkspaceDiff = {
  changedFiles: [{ status: "M", path: "src/app.tsx" }],
  diff: [
    "diff --git a/src/app.tsx b/src/app.tsx",
    "--- a/src/app.tsx",
    "+++ b/src/app.tsx",
    "@@ -1,1 +1,2 @@",
    " const app = true;",
    '+import { Toolbar } from "my-product/react";',
  ].join("\n"),
};

// "my-product/react" appears only in a context line (no leading +), so the
// agent did not introduce it.
const PREEXISTING_IMPORT: WorkspaceDiff = {
  changedFiles: [{ status: "M", path: "src/app.tsx" }],
  diff: [
    "@@ -1,1 +1,2 @@",
    ' import { Toolbar } from "my-product/react";',
    "+const x = 1;",
  ].join("\n"),
};

function satisfied(diff: WorkspaceDiff, checks: DiffChecks): boolean {
  return checkDiff(diff, checks).every((r) => r.satisfied);
}

describe("diff verifier", () => {
  test("mustChange matches a changed path by glob", () => {
    expect(satisfied(ADDED_IMPORT, { mustChange: ["src/**/*.tsx"] })).toBe(
      true,
    );
    expect(satisfied(ADDED_IMPORT, { mustChange: ["app/**/*.ts"] })).toBe(
      false,
    );
  });

  test("mustNotChange fails when a forbidden path changed", () => {
    const pkg: WorkspaceDiff = {
      changedFiles: [{ status: "M", path: "package.json" }],
      diff: "",
    };
    expect(satisfied(pkg, { mustNotChange: ["package.json"] })).toBe(false);
    expect(satisfied(ADDED_IMPORT, { mustNotChange: ["package.json"] })).toBe(
      true,
    );
  });

  test("mustContain matches a substring the agent added", () => {
    expect(satisfied(ADDED_IMPORT, { mustContain: ["my-product/react"] })).toBe(
      true,
    );
  });

  test("mustContain is not satisfied by pre-existing context lines", () => {
    expect(
      satisfied(PREEXISTING_IMPORT, { mustContain: ["my-product/react"] }),
    ).toBe(false);
  });

  test("mustNotContain fails when the agent added a forbidden substring", () => {
    const bad: WorkspaceDiff = {
      changedFiles: [{ status: "M", path: "src/app.tsx" }],
      diff: "@@ -1 +1,2 @@\n const x = 1;\n+import { legacyReactAdapter } from 'x';",
    };
    expect(satisfied(bad, { mustNotContain: ["legacyReactAdapter"] })).toBe(
      false,
    );
    expect(
      satisfied(ADDED_IMPORT, { mustNotContain: ["legacyReactAdapter"] }),
    ).toBe(true);
  });
});
