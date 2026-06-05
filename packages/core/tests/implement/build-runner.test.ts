import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Build, Config } from "@pickled-dev/config";
import { proveBuild, runBuildCell } from "../../src/implement/build-runner.js";
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

/** A fake editing target: runs `edit(cwd)` to mutate the workspace. */
function editingTarget(
  edit: (cwd: string) => void,
): (name: string) => TargetRunner {
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

function config(
  agent = "builder",
  category: "cli" | "api" = "cli",
  provider = "claude-code",
): Config {
  return {
    product: { name: "t", description: "d" },
    sources: {},
    agents: { [agent]: { category, provider, model: "m" } },
    contexts: { mem: { mode: "memory" } },
    facts: {},
    misstatements: {},
    questions: [],
    builds: [],
    thresholds: {},
  };
}

function build(fixture: string, overrides: Partial<Build> = {}): Build {
  return {
    id: "add_answer",
    goal: "Make the test pass.",
    agents: ["builder"],
    contexts: ["mem"],
    trials: 1,
    requires: [],
    workspace: { path: fixture, setup: [] },
    verifier: {
      failToPass: [{ name: "tests", run: "grep -q ok src/answer.txt" }],
      passToPass: [],
    },
    ...overrides,
  };
}

function run(args: {
  fixture: string;
  build?: Partial<Build>;
  agent?: string;
  config?: Config;
  targetFactory: (name: string) => TargetRunner;
  agentTimeoutMs?: number;
}) {
  return runBuildCell({
    build: build(args.fixture, args.build),
    agent: args.agent ?? "builder",
    contextName: "mem",
    config: args.config ?? config(),
    sources: [],
    options: {
      tool: { name: "t", description: "d", path: args.fixture },
      targetFactory: (name) => args.targetFactory(name),
      agentTimeoutMs: args.agentTimeoutMs,
    },
  });
}

const writeAnswer = (text: string) => (cwd: string) => {
  mkdirSync(join(cwd, "src"), { recursive: true });
  writeFileSync(join(cwd, "src", "answer.txt"), text);
};

describe("runBuildCell", () => {
  test("a clean build that passes verify is YES 1/1, verifier unproven", async () => {
    const fixture = makeFixture({ "src/placeholder.txt": "x\n" });
    const cell = await run({
      fixture,
      targetFactory: editingTarget(writeAnswer("ok\n")),
    });
    expect(cell.verdict).toBe("YES");
    expect(cell.passedAttempts).toBe(1);
    expect(cell.totalAttempts).toBe(1);
    expect(cell.verifierProof).toBe("not_declared");
    expect(cell.attempts[0]?.changedFiles?.[0]?.path).toBe("src/answer.txt");
  });

  test("an empty diff is vetoed to NO", async () => {
    const fixture = makeFixture({ "src/placeholder.txt": "x\n" });
    const cell = await run({ fixture, targetFactory: editingTarget(() => {}) });
    expect(cell.verdict).toBe("NO");
    expect(cell.attempts[0]?.reason).toContain("no changes");
  });

  test("a change that fails verify is NO", async () => {
    const fixture = makeFixture({ "src/placeholder.txt": "x\n" });
    const cell = await run({
      fixture,
      targetFactory: editingTarget(writeAnswer("nope\n")),
    });
    expect(cell.verdict).toBe("NO");
    expect(cell.attempts[0]?.reason).toContain("verification failed");
  });

  test("weakening a baseline test file is vetoed to NO", async () => {
    const fixture = makeFixture({
      "src/placeholder.txt": "x\n",
      "src/feature.test.ts": "assert(real)\n",
    });
    const cell = await run({
      fixture,
      targetFactory: editingTarget((cwd) => {
        writeAnswer("ok\n")(cwd);
        writeFileSync(join(cwd, "src", "feature.test.ts"), "// removed\n");
      }),
    });
    expect(cell.verdict).toBe("NO");
    expect(cell.attempts[0]?.reason).toContain("weakened the test harness");
  });

  test("adding a new test file is allowed", async () => {
    const fixture = makeFixture({ "src/placeholder.txt": "x\n" });
    const cell = await run({
      fixture,
      targetFactory: editingTarget((cwd) => {
        writeAnswer("ok\n")(cwd);
        writeFileSync(join(cwd, "src", "new.test.ts"), "// added\n");
      }),
    });
    expect(cell.verdict).toBe("YES");
  });

  test("a setup failure is an Error cell, excluded from scoring", async () => {
    const fixture = makeFixture({ "src/placeholder.txt": "x\n" });
    const cell = await run({
      fixture,
      build: { workspace: { path: fixture, setup: ["exit 1"] } },
      targetFactory: editingTarget(writeAnswer("ok\n")),
    });
    expect(cell.error).toContain("setup failed");
    expect(cell.totalAttempts).toBe(0);
  });

  test("an already-green fixture (failToPass passes untouched) is an Error cell", async () => {
    const fixture = makeFixture({ "src/answer.txt": "ok\n" });
    const cell = await run({
      fixture,
      targetFactory: editingTarget(writeAnswer("ok\n")),
    });
    expect(cell.error).toContain("invalid fixture");
    expect(cell.error).toContain("failToPass already passes");
  });

  test("a passToPass that fails on the untouched fixture is an Error cell", async () => {
    const fixture = makeFixture({ "src/placeholder.txt": "x\n" });
    const cell = await run({
      fixture,
      build: {
        verifier: {
          failToPass: [{ name: "tests", run: "grep -q ok src/answer.txt" }],
          // The regression guard is red on the baseline: a broken fixture.
          passToPass: [{ name: "guard", run: "grep -q base src/guard.txt" }],
        },
      },
      targetFactory: editingTarget(writeAnswer("ok\n")),
    });
    expect(cell.error).toContain("invalid fixture");
    expect(cell.error).toContain("passToPass fails");
  });

  test("a passToPass regression guard that the agent breaks fails the trial", async () => {
    const fixture = makeFixture({
      "src/placeholder.txt": "x\n",
      "src/guard.txt": "base\n",
    });
    const cell = await run({
      fixture,
      build: {
        verifier: {
          failToPass: [{ name: "tests", run: "grep -q ok src/answer.txt" }],
          passToPass: [{ name: "guard", run: "grep -q base src/guard.txt" }],
        },
      },
      // Satisfies failToPass but clobbers the regression guard.
      targetFactory: editingTarget((cwd) => {
        writeAnswer("ok\n")(cwd);
        writeFileSync(join(cwd, "src", "guard.txt"), "broken\n");
      }),
    });
    expect(cell.verdict).toBe("NO");
    expect(cell.attempts[0]?.reason).toContain("guard");
    const guard = cell.attempts[0]?.commands?.find((c) => c.name === "guard");
    expect(guard?.group).toBe("passToPass");
    expect(guard?.passed).toBe(false);
  });

  test("a reference solution that does not apply -> error cell, no agent trials", async () => {
    const fixture = makeFixture({ "src/placeholder.txt": "x\n" });
    const badPatch = join(fixture, "bad.patch");
    writeFileSync(badPatch, "this is not a valid git patch\n");
    let ran = false;
    const cell = await run({
      fixture,
      build: { referenceSolution: { patch: badPatch } },
      targetFactory: editingTarget(() => {
        ran = true;
      }),
    });
    expect(cell.verifierProof).toBe("failed");
    expect(cell.error).toContain("reference solution");
    expect(cell.totalAttempts).toBe(0);
    expect(ran).toBe(false); // the bar is unproven, so the agent never runs
  });

  test("strict k/n: a flaky agent that builds 1 of 3 is PARTIAL 1/3", async () => {
    const fixture = makeFixture({ "src/placeholder.txt": "x\n" });
    let call = 0;
    const cell = await run({
      fixture,
      build: { trials: 3 },
      targetFactory: editingTarget((cwd) => {
        call += 1;
        writeAnswer(call === 1 ? "ok\n" : "nope\n")(cwd);
      }),
    });
    expect(cell.verdict).toBe("PARTIAL");
    expect(cell.passedAttempts).toBe(1);
    expect(cell.totalAttempts).toBe(3);
    expect(cell.passRate).toBe(33);
  });

  test("trials are independent: trial 2 does not inherit trial 1's edits", async () => {
    const fixture = makeFixture({ "src/placeholder.txt": "x\n" });
    let call = 0;
    const cell = await run({
      fixture,
      build: { trials: 2 },
      targetFactory: editingTarget((cwd) => {
        call += 1;
        if (call === 1) writeAnswer("ok\n")(cwd);
      }),
    });
    expect(cell.passedAttempts).toBe(1);
    expect(cell.attempts[1]?.reason).toContain("no changes");
  });

  test("an API agent is rejected by the edit-capable gate before any run", async () => {
    const fixture = makeFixture({ "src/placeholder.txt": "x\n" });
    let ran = false;
    const cell = await run({
      fixture,
      agent: "api",
      config: config("api", "api", "openai"),
      targetFactory: () =>
        editingTarget(() => {
          ran = true;
        })("api"),
    });
    expect(cell.error).toContain("cannot run build");
    expect(ran).toBe(false);
  });

  test("renaming a baseline test away is a harness veto", async () => {
    const fixture = makeFixture({
      "src/placeholder.txt": "x\n",
      "src/feature.test.ts": "assert(real)\n",
    });
    const cell = await run({
      fixture,
      targetFactory: editingTarget((cwd) => {
        writeAnswer("ok\n")(cwd);
        rmSync(join(cwd, "src", "feature.test.ts"));
        writeFileSync(join(cwd, "src", "feature.ts"), "assert(real)\n");
      }),
    });
    expect(cell.verdict).toBe("NO");
    expect(cell.attempts[0]?.reason).toContain("weakened the test harness");
    expect(cell.attempts[0]?.reason).toContain("feature.test.ts");
  });

  test("an agent that throws becomes an error cell, not a crash", async () => {
    const fixture = makeFixture({ "src/placeholder.txt": "x\n" });
    const cell = await run({
      fixture,
      targetFactory: () => ({
        category: "cli",
        provider: "claude-code",
        name: "boom",
        async run(): Promise<never> {
          throw new Error("codex exec failed");
        },
      }),
    });
    expect(cell.error).toContain("could not measure");
    expect(cell.totalAttempts).toBe(0);
  });

  test("reaching the turn budget counts as a failed trial", async () => {
    const fixture = makeFixture({ "src/placeholder.txt": "x\n" });
    const cell = await run({
      fixture,
      targetFactory: () => ({
        category: "cli",
        provider: "claude-code",
        name: "turn-limit",
        async run(): Promise<never> {
          throw new Error(
            "Claude Code returned an error result: Reached maximum number of turns (30)",
          );
        },
      }),
    });
    expect(cell.error).toBeUndefined();
    expect(cell.verdict).toBe("NO");
    expect(cell.attempts[0]?.status).toBe("failed");
    expect(cell.attempts[0]?.reason).toContain("turn budget");
  });

  test("exceeding the timeout is a failed trial and is cancelled", async () => {
    const fixture = makeFixture({ "src/placeholder.txt": "x\n" });
    let aborted = false;
    const cell = await run({
      fixture,
      agentTimeoutMs: 100,
      targetFactory: () => ({
        category: "cli",
        provider: "claude-code",
        name: "hang",
        run(_p, options): Promise<TargetResult> {
          return new Promise((_resolve, reject) => {
            options.signal?.addEventListener("abort", () => {
              aborted = true;
              reject(new Error("aborted"));
            });
          });
        },
      }),
    });
    expect(aborted).toBe(true);
    expect(cell.verdict).toBe("NO");
    expect(cell.attempts[0]?.reason).toContain("budget");
  });

  test("an error trial is excluded from k/n; passing trials still score", async () => {
    const fixture = makeFixture({ "src/placeholder.txt": "x\n" });
    let call = 0;
    const cell = await run({
      fixture,
      build: { trials: 3 },
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
    });
    expect(cell.verdict).toBe("YES");
    expect(cell.passedAttempts).toBe(2);
    expect(cell.totalAttempts).toBe(2);
    expect(cell.attempts).toHaveLength(3); // receipt keeps the error
  });
});

describe("proveBuild (harness proof, no agent)", () => {
  test("no reference solution -> unproven", async () => {
    const fixture = makeFixture({ "src/placeholder.txt": "x\n" });
    const proof = await proveBuild(build(fixture), fixture);
    expect(proof.status).toBe("unproven");
    expect(proof.verifierProof).toBe("not_declared");
    expect(proof.message).toBeUndefined();
  });

  test("a fixture whose failToPass already passes -> broken", async () => {
    const fixture = makeFixture({ "src/answer.txt": "ok\n" });
    const proof = await proveBuild(build(fixture), fixture);
    expect(proof.status).toBe("broken");
    expect(proof.message).toContain("failToPass already passes");
  });

  test("a reference patch that does not apply -> broken", async () => {
    const fixture = makeFixture({ "src/placeholder.txt": "x\n" });
    const badPatch = join(fixture, "bad.patch");
    writeFileSync(badPatch, "this is not a valid git patch\n");
    const proof = await proveBuild(
      build(fixture, { referenceSolution: { patch: badPatch } }),
      fixture,
    );
    expect(proof.status).toBe("broken");
    expect(proof.verifierProof).toBe("failed");
    expect(proof.message).toContain("reference solution");
  });

  test("a reference patch that clears the verifier -> proven", async () => {
    const fixture = makeFixture({ "src/answer.txt": "x\n" });
    const patch = join(fixture, "fix.patch");
    writeFileSync(
      patch,
      "--- a/src/answer.txt\n+++ b/src/answer.txt\n@@ -1 +1 @@\n-x\n+ok\n",
    );
    const proof = await proveBuild(
      build(fixture, { referenceSolution: { patch } }),
      fixture,
    );
    expect(proof.status).toBe("proven");
    expect(proof.verifierProof).toBe("passed");
  });
});
