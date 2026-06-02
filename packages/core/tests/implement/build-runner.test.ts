import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { CheckConfig } from "@pickled-dev/config";
import {
  type BuildCellInput,
  type BuildTask,
  runBuildCell,
} from "../../src/implement/build-runner.js";
import type {
  RunOptions,
  TargetResult,
  TargetRunner,
} from "../../src/targets/types.js";

const created: string[] = [];
afterEach(() => {
  for (const d of created.splice(0))
    rmSync(d, { recursive: true, force: true });
});

/**
 * A fake build fixture: a project whose test passes only when src/answer.txt
 * contains "ok". `verify` is a shell check, so no toolchain is needed.
 */
function makeFixture(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "pickled-bfix-"));
  created.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return dir;
}

/** A fake editing target: writes the given files into the workspace cwd. */
function editingTarget(
  edit: (cwd: string) => void,
): (name: string, config: unknown) => TargetRunner {
  return (name) => ({
    category: "cli",
    provider: "claude-code",
    name,
    async run(_prompt: string, options: RunOptions): Promise<TargetResult> {
      edit(options.cwd);
      return {
        response: "done",
        allResponses: [{ type: "final", text: "done" }],
        toolsUsed: [],
        sources: [],
        metadata: {
          model: "fake",
          category: "cli",
          provider: "claude-code",
          target: name,
        },
      };
    },
  });
}

const CONFIG: CheckConfig = {
  tool: { name: "t", description: "d" },
  toolsets: { none: {} },
  targets: { builder: { category: "cli", provider: "claude-code" } },
  scenarios: [],
};

function baseInput(
  fixture: string,
  overrides: Partial<BuildCellInput> = {},
): BuildCellInput {
  const task: BuildTask = {
    name: "add_answer",
    prompt: "Make the test pass.",
    workspacePath: fixture,
    setup: [],
    // Pass iff src/answer.txt says ok. A bare `grep` over a missing file
    // exits non-zero, so the untouched fixture fails (good).
    verify: [{ name: "tests", run: "grep -q ok src/answer.txt" }],
    trials: 1,
  };
  return {
    task,
    interfaceName: "builder",
    accessPair: { access: "memory", source: "none", toolset: "none" },
    config: CONFIG,
    docs: [],
    tool: { name: "t", description: "d", path: fixture },
    contextConfig: {},
    ...overrides,
  };
}

const writeAnswer = (text: string) => (cwd: string) => {
  mkdirSync(join(cwd, "src"), { recursive: true });
  writeFileSync(join(cwd, "src", "answer.txt"), text);
};

describe("runBuildCell", () => {
  test("a clean build that passes verify is YES 1/1", async () => {
    const fixture = makeFixture({ "src/placeholder.txt": "x\n" });
    const cell = await runBuildCell(
      baseInput(fixture, { targetFactory: editingTarget(writeAnswer("ok\n")) }),
    );
    expect(cell.taskKind).toBe("build");
    expect(cell.answerable).toBe("YES");
    expect(cell.build?.passedAttempts).toBe(1);
    expect(cell.build?.totalAttempts).toBe(1);
    expect(cell.build?.attempts[0]?.changedFiles?.[0]?.path).toBe(
      "src/answer.txt",
    );
  });

  test("an agent that changes nothing is vetoed to NO (empty diff)", async () => {
    const fixture = makeFixture({ "src/placeholder.txt": "x\n" });
    const cell = await runBuildCell(
      baseInput(fixture, { targetFactory: editingTarget(() => {}) }),
    );
    expect(cell.answerable).toBe("NO");
    expect(cell.build?.attempts[0]?.reason).toContain("no changes");
  });

  test("an agent whose change fails verify is NO", async () => {
    const fixture = makeFixture({ "src/placeholder.txt": "x\n" });
    const cell = await runBuildCell(
      baseInput(fixture, {
        targetFactory: editingTarget(writeAnswer("nope\n")),
      }),
    );
    expect(cell.answerable).toBe("NO");
    expect(cell.build?.attempts[0]?.reason).toContain("verification failed");
  });

  test("weakening a baseline test file is vetoed to NO", async () => {
    const fixture = makeFixture({
      "src/placeholder.txt": "x\n",
      "src/feature.test.ts": "assert(real)\n",
    });
    const cell = await runBuildCell(
      baseInput(fixture, {
        targetFactory: editingTarget((cwd) => {
          // Pass the real check but gut the baseline test.
          writeAnswer("ok\n")(cwd);
          writeFileSync(join(cwd, "src", "feature.test.ts"), "// removed\n");
        }),
      }),
    );
    expect(cell.answerable).toBe("NO");
    expect(cell.build?.attempts[0]?.reason).toContain(
      "weakened the test harness",
    );
  });

  test("adding a new test file is allowed (not a harness veto)", async () => {
    const fixture = makeFixture({ "src/placeholder.txt": "x\n" });
    const cell = await runBuildCell(
      baseInput(fixture, {
        targetFactory: editingTarget((cwd) => {
          writeAnswer("ok\n")(cwd);
          writeFileSync(join(cwd, "src", "new.test.ts"), "// added\n");
        }),
      }),
    );
    expect(cell.answerable).toBe("YES");
  });

  test("a setup failure is an Error cell, excluded from scoring", async () => {
    const fixture = makeFixture({ "src/placeholder.txt": "x\n" });
    const input = baseInput(fixture, {
      targetFactory: editingTarget(writeAnswer("ok\n")),
    });
    input.task.setup = ["exit 1"];
    const cell = await runBuildCell(input);
    expect(cell.error).toContain("setup failed");
    expect(cell.build).toBeUndefined();
  });

  test("a fixture that is already green is an Error cell (vacuous)", async () => {
    // answer.txt already says ok, so verify passes untouched.
    const fixture = makeFixture({ "src/answer.txt": "ok\n" });
    const cell = await runBuildCell(
      baseInput(fixture, { targetFactory: editingTarget(writeAnswer("ok\n")) }),
    );
    expect(cell.error).toContain("invalid fixture");
    expect(cell.build).toBeUndefined();
  });

  test("strict k/n: a flaky agent that builds once of three is PARTIAL", async () => {
    const fixture = makeFixture({ "src/placeholder.txt": "x\n" });
    let call = 0;
    const cell = await runBuildCell(
      baseInput(fixture, {
        targetFactory: editingTarget((cwd) => {
          call += 1;
          writeAnswer(call === 1 ? "ok\n" : "nope\n")(cwd);
        }),
        task: { ...baseInput(fixture).task, trials: 3 },
      }),
    );
    expect(cell.answerable).toBe("PARTIAL");
    expect(cell.build?.passedAttempts).toBe(1);
    expect(cell.build?.totalAttempts).toBe(3);
    expect(cell.confidence).toBe(33);
  });

  test("trials are independent: trial 2 does not inherit trial 1's edits", async () => {
    const fixture = makeFixture({ "src/placeholder.txt": "x\n" });
    let call = 0;
    const cell = await runBuildCell(
      baseInput(fixture, {
        // Only the FIRST trial writes ok. If workspaces leaked, trial 2 would
        // still see ok and pass; independence means trial 2 starts clean and
        // (writing nothing) is an empty-diff NO.
        targetFactory: editingTarget((cwd) => {
          call += 1;
          if (call === 1) writeAnswer("ok\n")(cwd);
        }),
        task: { ...baseInput(fixture).task, trials: 2 },
      }),
    );
    expect(cell.build?.passedAttempts).toBe(1);
    expect(cell.build?.attempts[1]?.reason).toContain("no changes");
  });

  test("an API agent is rejected by the edit-capable gate before any run", async () => {
    const fixture = makeFixture({ "src/placeholder.txt": "x\n" });
    let ran = false;
    const input = baseInput(fixture, {
      interfaceName: "api",
      config: {
        tool: { name: "t", description: "d" },
        toolsets: { none: {} },
        targets: { api: { category: "api", provider: "openai", model: "m" } },
        scenarios: [],
      },
      targetFactory: () =>
        editingTarget(() => {
          ran = true;
        })("api"),
    });
    await expect(runBuildCell(input)).rejects.toThrow(/cannot run build tasks/);
    expect(ran).toBe(false);
  });

  test("renaming a baseline test away is a harness veto (rename evidence)", async () => {
    const fixture = makeFixture({
      "src/placeholder.txt": "x\n",
      "src/feature.test.ts": "assert(real)\n",
    });
    const cell = await runBuildCell(
      baseInput(fixture, {
        targetFactory: editingTarget((cwd) => {
          writeAnswer("ok\n")(cwd);
          // Rename the baseline test to a non-test name: a disguised delete.
          rmSync(join(cwd, "src", "feature.test.ts"));
          writeFileSync(join(cwd, "src", "feature.ts"), "assert(real)\n");
        }),
      }),
    );
    expect(cell.answerable).toBe("NO");
    expect(cell.build?.attempts[0]?.reason).toContain(
      "weakened the test harness",
    );
    expect(cell.build?.attempts[0]?.reason).toContain("feature.test.ts");
  });

  test("an agent that throws becomes an error trial, not a crashed cell", async () => {
    const fixture = makeFixture({ "src/placeholder.txt": "x\n" });
    const cell = await runBuildCell(
      baseInput(fixture, {
        targetFactory: () => ({
          category: "cli",
          provider: "claude-code",
          name: "boom",
          async run(): Promise<never> {
            throw new Error("codex exec failed");
          },
        }),
      }),
    );
    // One trial, it errored: no scored attempts, so the cell is an Error.
    expect(cell.error).toContain("could not measure");
    expect(cell.build).toBeUndefined();
  });

  test("an error trial is excluded from k/n; passing trials still score", async () => {
    const fixture = makeFixture({ "src/placeholder.txt": "x\n" });
    let call = 0;
    const cell = await runBuildCell(
      baseInput(fixture, {
        // Trial 1 throws (error, excluded); trials 2-3 build cleanly.
        targetFactory: () => ({
          category: "cli",
          provider: "claude-code",
          name: "flaky",
          async run(_p, options): Promise<TargetResult> {
            call += 1;
            if (call === 1) throw new Error("transient infra blip");
            writeAnswer("ok\n")(options.cwd);
            return {
              response: "done",
              allResponses: [{ type: "final", text: "done" }],
              toolsUsed: [],
              sources: [],
              metadata: {
                model: "f",
                category: "cli",
                provider: "claude-code",
                target: "flaky",
              },
            };
          },
        }),
        task: { ...baseInput(fixture).task, trials: 3 },
      }),
    );
    // 3 trials: 1 error (excluded), 2 passed -> 2/2, not 2/3.
    expect(cell.answerable).toBe("YES");
    expect(cell.build?.passedAttempts).toBe(2);
    expect(cell.build?.totalAttempts).toBe(2);
    expect(cell.build?.attempts).toHaveLength(3); // receipt keeps the error
  });
});
