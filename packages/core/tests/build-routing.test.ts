import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CheckConfig } from "@pickled-dev/config";
import { runCheck } from "../src/check.js";
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

// A fixture whose verify passes only after src/answer.txt says "ok".
function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "pickled-route-"));
  created.push(dir);
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "src", "placeholder.txt"), "x\n");
  return dir;
}

// A fake editing target that writes the given answer into the workspace.
function writer(text: string): (n: string) => TargetRunner {
  return (name) => ({
    category: "cli",
    provider: "claude-code",
    name,
    async run(_p: string, options: RunOptions): Promise<TargetResult> {
      mkdirSync(join(options.cwd, "src"), { recursive: true });
      writeFileSync(join(options.cwd, "src", "answer.txt"), text);
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

function buildConfig(path: string, trials: number): CheckConfig {
  return {
    tool: { name: "t", description: "d" },
    toolsets: { none: {} },
    targets: { builder: { category: "cli", provider: "claude-code" } },
    scenarios: [
      {
        name: "toolbar",
        prompt: "Make the test pass.",
        kind: "build",
        matrix: {
          interfaces: ["builder"],
          accessPairs: [{ access: "mem", source: "none", toolset: "none" }],
        },
        workspace: { path, setup: [] },
        verify: ["grep -q ok src/answer.txt"],
        trials,
      },
    ],
  };
}

const tool = (path: string) => ({ name: "t", description: "d", path });

describe("runCheck build routing", () => {
  test("routes a build scenario to the build runner (k/n cell, not answer-scored)", async () => {
    const path = fixture();
    const report = await runCheck(tool(path), buildConfig(path, 1), {
      targetFactory: writer("ok\n"),
    });
    const cell = report.scenarios[0]!.cells![0]!;
    expect(cell.taskKind).toBe("build");
    expect(cell.build?.passedAttempts).toBe(1);
    expect(cell.build?.totalAttempts).toBe(1);
    expect(cell.answerable).toBe("YES");
    // Build cell carries no answer expected-checks block.
    expect(cell.expected).toBeUndefined();
  });

  test("--max-cells gates trial-expanded executions, not cells", async () => {
    const path = fixture();
    // 1 cell x 3 trials = 3 executions. maxCells 2 must reject before any run.
    await expect(
      runCheck(tool(path), buildConfig(path, 3), {
        maxCells: 2,
        targetFactory: writer("ok\n"),
      }),
    ).rejects.toThrow(/3 executions \(1 cells.*exceeding --max-cells 2/);
    // maxCells 3 fits.
    const report = await runCheck(tool(path), buildConfig(path, 3), {
      maxCells: 3,
      targetFactory: writer("ok\n"),
    });
    expect(report.scenarios[0]!.cells![0]!.build?.totalAttempts).toBe(3);
  });

  test("--plan reports both selected cells and trial-expanded executions", async () => {
    const path = fixture();
    const report = await runCheck(tool(path), buildConfig(path, 3), {
      plan: true,
    });
    expect(report.plan?.selectedCells).toBe(1);
    expect(report.plan?.selectedExecutions).toBe(3);
    expect(report.plan?.expandedExecutions).toBe(3);
    // The plan cell carries its trial count.
    expect(report.plan?.cells?.[0]?.trials).toBe(3);
  });

  test("verbose progress renders build cells as Built k/n with the access label", async () => {
    const path = fixture();
    const lines: string[] = [];
    await runCheck(tool(path), buildConfig(path, 1), {
      targetFactory: writer("ok\n"),
      onProgress: (msg) => lines.push(msg),
    });
    const out = lines.join("\n");
    // Build verdict family + k/n, never the grounded answer scale.
    expect(out).toContain("Built 1/1");
    expect(out).not.toContain("Well grounded");
    // Access-aware label (agent · access), not agent · source · toolset.
    expect(out).toContain("[builder · mem]");
    expect(out).not.toContain("builder · none · none");
  });

  test("an answer run reports executions equal to cells (trials inert)", async () => {
    const path = fixture();
    const answerConfig: CheckConfig = {
      tool: { name: "t", description: "d" },
      toolsets: { none: {} },
      targets: { quick: { category: "cli", provider: "claude-code" } },
      scenarios: [
        {
          name: "q",
          prompt: "?",
          matrix: {
            interfaces: ["quick"],
            accessPairs: [{ access: "mem", source: "none", toolset: "none" }],
          },
          expected: { includes: ["x"] },
        },
      ],
    };
    const report = await runCheck(tool(path), answerConfig, { plan: true });
    expect(report.plan?.selectedCells).toBe(1);
    expect(report.plan?.selectedExecutions).toBe(1);
    expect(report.plan?.cells?.[0]?.trials).toBeUndefined();
  });
});
