import { describe, expect, test } from "bun:test";
import type { Target } from "@pickled-dev/config";
import {
  CodexCliTarget,
  type SpawnFn,
  type SpawnResult,
} from "../../src/targets/cli/codex.js";

const baseConfig: Target = {
  category: "cli",
  provider: "codex-cli",
  model: "gpt-5",
};

const baseRunOptions = {
  tool: { name: "t", description: "d", path: "/tmp/x" },
  cwd: "/tmp/x",
  docs: [],
  requiredSources: [],
};

function makeSpawn(result: SpawnResult): {
  spawn: SpawnFn;
  calls: Array<{
    cmd: string;
    args: string[];
    options: { cwd: string; stdin: string };
  }>;
} {
  const calls: Array<{
    cmd: string;
    args: string[];
    options: { cwd: string; stdin: string };
  }> = [];
  const spawn: SpawnFn = async (cmd, args, options) => {
    calls.push({ cmd, args, options });
    return result;
  };
  return { spawn, calls };
}

function makeReadFile(content: string) {
  return async (_path: string) => content;
}

describe("CodexCliTarget - happy path", () => {
  test("returns the last-message file contents as response", async () => {
    const { spawn } = makeSpawn({
      exitCode: 0,
      stdout: "",
      stderr: "",
    });
    const target = new CodexCliTarget("codex", baseConfig, {
      spawn,
      readFile: makeReadFile("Answer.\n\n## Sources\n- [readme] note\n"),
    });
    const result = await target.run("How do I install?", baseRunOptions);
    expect(result.response).toBe("Answer.\n\n## Sources\n- [readme] note");
    expect(result.metadata.provider).toBe("codex-cli");
    expect(result.metadata.model).toBe("gpt-5");
  });

  test("populates allResponses from JSONL stream (best-effort)", async () => {
    const stream = [
      JSON.stringify({ type: "assistant_message", text: "Thinking..." }),
      JSON.stringify({ type: "tool_call", name: "Read" }),
      JSON.stringify({ type: "assistant_message", text: "Final answer." }),
    ].join("\n");
    const { spawn } = makeSpawn({ exitCode: 0, stdout: stream, stderr: "" });
    const target = new CodexCliTarget("codex", baseConfig, {
      spawn,
      readFile: makeReadFile("Final answer."),
    });
    const result = await target.run("q", baseRunOptions);
    expect(result.allResponses.map((r) => r.text)).toEqual([
      "Thinking...",
      "Final answer.",
    ]);
    expect(result.allResponses[result.allResponses.length - 1]!.type).toBe(
      "final",
    );
    expect(result.toolsUsed).toEqual(["Read"]);
  });
});

describe("CodexCliTarget - flag spelling", () => {
  test("passes the locked flag set", async () => {
    const { spawn, calls } = makeSpawn({
      exitCode: 0,
      stdout: "",
      stderr: "",
    });
    const target = new CodexCliTarget("codex", baseConfig, {
      spawn,
      readFile: makeReadFile("Answer."),
    });
    await target.run("q", baseRunOptions);

    const args = calls[0]!.args;
    expect(args[0]).toBe("--ask-for-approval");
    expect(args[1]).toBe("never");
    expect(args[2]).toBe("exec");
    expect(args).toContain("--json");
    expect(args).toContain("--sandbox");
    expect(args[args.indexOf("--sandbox") + 1]).toBe("read-only");
    expect(args).toContain("--ignore-user-config");
    expect(args).toContain("--ignore-rules");
    expect(args).toContain("--ephemeral");
    expect(args).toContain("--skip-git-repo-check");
    expect(args).toContain("--cd");
    expect(args[args.indexOf("--cd") + 1]).toBe("/tmp/x");
    expect(args).toContain("--model");
    expect(args[args.indexOf("--model") + 1]).toBe("gpt-5");
    expect(args).toContain("--output-last-message");
    expect(args[args.length - 1]).toBe("-");
  });

  test("writes the citation prompt to stdin, not argv", async () => {
    const { spawn, calls } = makeSpawn({
      exitCode: 0,
      stdout: "",
      stderr: "",
    });
    const target = new CodexCliTarget("codex", baseConfig, {
      spawn,
      readFile: makeReadFile("Answer."),
    });
    await target.run("How do I install?", baseRunOptions);
    const stdin = calls[0]!.options.stdin;
    expect(stdin).toContain("Answer using ONLY information");
    expect(stdin).toContain("How do I install?");
    expect(calls[0]!.args.join(" ")).not.toContain("How do I install?");
  });
});

describe("CodexCliTarget - resilience", () => {
  test("ignores malformed JSONL lines without throwing", async () => {
    const stream = [
      JSON.stringify({ type: "assistant_message", text: "Good line" }),
      "{not valid json}",
      JSON.stringify({ type: "assistant_message", text: "Another good line" }),
    ].join("\n");
    const { spawn } = makeSpawn({ exitCode: 0, stdout: stream, stderr: "" });
    const target = new CodexCliTarget("codex", baseConfig, {
      spawn,
      readFile: makeReadFile("Final."),
    });
    const result = await target.run("q", baseRunOptions);
    expect(result.allResponses).toHaveLength(2);
  });

  test("throws when codex exits non-zero AND no last-message available", async () => {
    const { spawn } = makeSpawn({
      exitCode: 1,
      stdout: "",
      stderr: "boom",
    });
    const failingRead = async () => {
      throw new Error("missing");
    };
    const target = new CodexCliTarget("codex", baseConfig, {
      spawn,
      readFile: failingRead,
    });
    await expect(target.run("q", baseRunOptions)).rejects.toThrow(
      /codex exec failed.*boom/,
    );
  });

  test("throws when codex exits non-zero even if last-message exists", async () => {
    const { spawn } = makeSpawn({
      exitCode: 1,
      stdout: "",
      stderr: "failed after partial output",
    });
    const target = new CodexCliTarget("codex", baseConfig, {
      spawn,
      readFile: makeReadFile("Partial answer."),
    });
    await expect(target.run("q", baseRunOptions)).rejects.toThrow(
      /failed after partial output/,
    );
  });

  test("falls back to last stream message when last-message file is missing", async () => {
    const stream = JSON.stringify({
      type: "assistant_message",
      text: "Stream final.",
    });
    const { spawn } = makeSpawn({ exitCode: 0, stdout: stream, stderr: "" });
    const failingRead = async () => {
      throw new Error("missing");
    };
    const target = new CodexCliTarget("codex", baseConfig, {
      spawn,
      readFile: failingRead,
    });
    const result = await target.run("q", baseRunOptions);
    expect(result.response).toBe("Stream final.");
  });

  test("throws if config is missing model (defense in depth past loader)", async () => {
    const target = new CodexCliTarget(
      "codex",
      { category: "cli", provider: "codex-cli" },
      {
        spawn: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
        readFile: makeReadFile("x"),
      },
    );
    await expect(target.run("q", baseRunOptions)).rejects.toThrow(
      /requires an explicit model/,
    );
  });
});
