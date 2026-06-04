import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Config } from "@pickled-dev/config";
import { run, runBuild, runCheck } from "../src/check.js";
import type {
  RunOptions,
  TargetResult,
  TargetRunner,
} from "../src/targets/types.js";

const created: string[] = [];
afterEach(() => {
  for (const d of created.splice(0))
    rmSync(d, { recursive: true, force: true });
});

const TOOL = { name: "t", description: "d", path: "/tmp" };

/** A fake target that returns a canned response (string or per-call function). */
function answerWith(
  response: string | ((agent: string, ctx: RunOptions) => string),
): (name: string) => TargetRunner {
  return (name) => ({
    category: "cli",
    provider: "claude-code",
    name,
    async run(_p: string, options: RunOptions): Promise<TargetResult> {
      const text =
        typeof response === "function" ? response(name, options) : response;
      return {
        response: text,
        allResponses: [{ type: "final", text }],
        toolsUsed: [],
        sources: [],
        metadata: {
          model: "m",
          category: "cli",
          provider: "claude-code",
          target: name,
        },
      };
    },
  });
}

function questionConfig(): Config {
  return {
    product: { name: "demo", description: "d" },
    sources: {},
    agents: { a: { category: "cli", provider: "claude-code", model: "m" } },
    contexts: { mem: { mode: "memory" }, mem2: { mode: "memory" } },
    facts: {
      install: { statement: "install", match: { allOf: ["bunx demo"] } },
      cmd: { statement: "cmd", match: { anyOf: ["check"] } },
    },
    misstatements: {},
    questions: [
      {
        id: "q1",
        question: "how to install?",
        agents: ["a"],
        contexts: ["mem", "mem2"],
        expects: ["install", "cmd"],
        rejects: [],
      },
    ],
    builds: [],
    thresholds: { questions: 80 },
  };
}

describe("runCheck (questions)", () => {
  test("a fully-covering answer scores YES; report shape + summary", async () => {
    const report = await runCheck(TOOL, questionConfig(), {
      targetFactory: (n) => answerWith("bunx demo check")(n),
    });
    expect(report.kind).toBe("questions");
    expect(report.questions).toHaveLength(1);
    const cells = report.questions?.[0]?.cells ?? [];
    expect(cells).toHaveLength(2);
    expect(cells.every((c) => c.verdict === "YES")).toBe(true);
    expect(report.summary).toMatchObject({
      total: 2,
      yes: 2,
      no: 0,
      errors: 0,
    });
    expect(report.summary.score).toBe(100);
    expect(report.threshold).toBe(80);
  });

  test("a partial answer scores PARTIAL with meanCoverage < 100", async () => {
    const report = await runCheck(TOOL, questionConfig(), {
      targetFactory: (n) => answerWith("bunx demo")(n),
    });
    const cells = report.questions?.[0]?.cells ?? [];
    expect(cells.every((c) => c.verdict === "PARTIAL")).toBe(true);
    expect(report.summary.partial).toBe(2);
    expect(report.summary.score).toBe(50);
  });

  test("--context filter narrows the cells", async () => {
    const report = await runCheck(TOOL, questionConfig(), {
      cellFilter: { context: "mem" },
      targetFactory: (n) => answerWith("bunx demo check")(n),
    });
    const cells = report.questions?.[0]?.cells ?? [];
    expect(cells).toHaveLength(1);
    expect(cells[0]?.coord.context).toBe("mem");
  });

  test("--max-cells throws before any run when exceeded", async () => {
    await expect(
      runCheck(TOOL, questionConfig(), {
        maxCells: 1,
        targetFactory: (n) => answerWith("x")(n),
      }),
    ).rejects.toThrow(/exceeding --max-cells/);
  });

  test("--sample is deterministic for a given seed", async () => {
    const opts = {
      sample: 1,
      seed: "abc",
      targetFactory: (n: string) => answerWith("bunx demo check")(n),
    };
    const a = await runCheck(TOOL, questionConfig(), opts);
    const b = await runCheck(TOOL, questionConfig(), opts);
    const ctxA = a.questions?.[0]?.cells.map((c) => c.coord.context);
    const ctxB = b.questions?.[0]?.cells.map((c) => c.coord.context);
    expect(ctxA).toEqual(ctxB);
    expect(ctxA).toHaveLength(1);
  });

  test("plan mode returns a dry-run report with planned cells and no questions", async () => {
    const report = await runCheck(TOOL, questionConfig(), {
      plan: true,
      targetFactory: (n) => answerWith("x")(n),
    });
    expect(report.questions).toBeUndefined();
    expect(report.plan?.expandedCells).toBe(2);
    expect(report.plan?.cells).toHaveLength(2);
  });

  test("an agent that throws yields an error cell counted under summary.errors", async () => {
    const report = await runCheck(TOOL, questionConfig(), {
      cellFilter: { context: "mem" },
      targetFactory: () => ({
        category: "cli",
        provider: "claude-code",
        name: "boom",
        async run(): Promise<never> {
          throw new Error("kaboom");
        },
      }),
    });
    expect(report.summary.errors).toBe(1);
    expect(report.questions?.[0]?.cells[0]?.error).toContain("kaboom");
  });

  test("throws when there are no questions to run", async () => {
    const cfg = questionConfig();
    cfg.questions = [];
    await expect(
      runCheck(TOOL, cfg, { targetFactory: (n) => answerWith("x")(n) }),
    ).rejects.toThrow(/No questions/);
  });
});

describe("runBuild (builds)", () => {
  function makeFixture(): string {
    const dir = mkdtempSync(join(tmpdir(), "pickled-orch-"));
    created.push(dir);
    const abs = join(dir, "src/placeholder.txt");
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, "x\n");
    return dir;
  }

  function buildConfig(fixture: string): Config {
    return {
      product: { name: "demo", description: "d" },
      sources: {},
      agents: {
        builder: { category: "cli", provider: "claude-code", model: "m" },
      },
      contexts: { mem: { mode: "memory" } },
      facts: {},
      misstatements: {},
      questions: [],
      builds: [
        {
          id: "b1",
          goal: "make the test pass",
          agents: ["builder"],
          contexts: ["mem"],
          trials: 1,
          requires: [],
          workspace: { path: fixture, setup: [] },
          verifier: {
            failToPass: [{ name: "t", run: "grep -q ok src/answer.txt" }],
            passToPass: [],
          },
        },
      ],
      thresholds: { builds: 80 },
    };
  }

  test("runBuild produces a builds report with k/n cells", async () => {
    const fixture = makeFixture();
    const report = await runBuild(TOOL, buildConfig(fixture), {
      targetFactory: () =>
        answerWith((_a, opts) => {
          mkdirSync(join(opts.cwd, "src"), { recursive: true });
          writeFileSync(join(opts.cwd, "src", "answer.txt"), "ok\n");
          return "done";
        })("builder"),
    });
    expect(report.kind).toBe("builds");
    const cell = report.builds?.[0]?.cells[0];
    expect(cell?.verdict).toBe("YES");
    expect(cell?.passedAttempts).toBe(1);
    expect(report.summary.yes).toBe(1);
    expect(report.threshold).toBe(80);
  });
});

describe("run dispatch", () => {
  test('run("question") routes to the questions report', async () => {
    const viaRun = await run("question", TOOL, questionConfig(), {
      plan: true,
      targetFactory: (n) => answerWith("x")(n),
    });
    expect(viaRun.kind).toBe("questions");
  });
});
