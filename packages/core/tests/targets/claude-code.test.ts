import { describe, expect, test } from "bun:test";
import { EDIT_ALLOWED_TOOLS, type Target } from "@pickled-dev/config";
import { buildAgentOptions } from "../../src/targets/cli/claude-code.js";
import type { RunOptions } from "../../src/targets/types.js";

const config: Target = {
  category: "cli",
  provider: "claude-code",
  model: "claude-sonnet-4-5",
};

const baseOptions: RunOptions = {
  tool: { name: "t", description: "d", path: "/tmp/x" },
  cwd: "/tmp/ws",
  promptContext: { kind: "question", mode: "memory" },
};

/** Build-mode options: the prompt context kind drives the edit profile. */
const buildOptions: RunOptions = {
  ...baseOptions,
  promptContext: { kind: "build", mode: "memory" },
};

describe("buildAgentOptions", () => {
  test("question mode keeps the read-biased defaults and acceptEdits", () => {
    const o = buildAgentOptions(config, baseOptions);
    expect(o.permissionMode).toBe("acceptEdits");
    expect(o.allowedTools).not.toContain("Write");
    expect(o.disallowedTools).toContain("Edit");
    expect(o.cwd).toBe("/tmp/ws");
  });

  test("build mode enables the workspace edit profile and bypassPermissions", () => {
    const o = buildAgentOptions(config, buildOptions);
    expect(o.permissionMode).toBe("bypassPermissions");
    expect(o.allowedTools).toContain("Edit");
    expect(o.allowedTools).toContain("MultiEdit");
    expect(o.allowedTools).toContain("Write");
    expect(o.allowedTools).toContain("Bash");
    expect(o.disallowedTools).toEqual([]);
  });

  test("restrictBuiltinTools still scopes the SDK built-ins when set", () => {
    const o = buildAgentOptions(config, {
      ...baseOptions,
      restrictBuiltinTools: ["WebSearch", "WebFetch"],
    });
    expect(o.tools).toEqual(["WebSearch", "WebFetch"]);
  });

  test("an empty restrictBuiltinTools disables all built-ins (question memory/inject)", () => {
    // cell-runtime sets restrictBuiltinTools: [] for question memory/inject
    // cells; the adapter must map that to SDK tools: [] (no built-ins), not
    // fall through to defaults, or those cells could silently web-search.
    const o = buildAgentOptions(config, {
      ...baseOptions,
      restrictBuiltinTools: [],
    });
    expect(o.tools).toEqual([]);
  });

  test("build mode hard-scopes SDK tools to the workspace edit set", () => {
    const o = buildAgentOptions(config, buildOptions);
    expect([...(o.tools ?? [])].sort()).toEqual([...EDIT_ALLOWED_TOOLS].sort());
  });

  test("build mode composes workspace tools with web access tools", () => {
    const o = buildAgentOptions(config, {
      ...buildOptions,
      restrictBuiltinTools: ["WebSearch", "WebFetch"],
    });
    for (const t of ["Edit", "Write", "Bash", "WebSearch", "WebFetch"]) {
      expect(o.tools).toContain(t);
    }
  });

  test("build mode keeps workspace tools when access scope is empty (mcp cells)", () => {
    const o = buildAgentOptions(config, {
      ...buildOptions,
      restrictBuiltinTools: [],
    });
    expect(o.tools).toContain("Edit");
    expect(o.tools).toContain("Write");
    expect(o.tools).toContain("Bash");
  });

  test("bridges the run signal to the SDK abortController", () => {
    const ac = new AbortController();
    const o = buildAgentOptions(config, { ...baseOptions, signal: ac.signal });
    expect(o.abortController).toBeInstanceOf(AbortController);
    expect(o.abortController?.signal.aborted).toBe(false);
    ac.abort();
    // Aborting the run's signal must flip the bridged controller too.
    expect(o.abortController?.signal.aborted).toBe(true);
  });

  test("an already-aborted signal yields an aborted controller", () => {
    const ac = new AbortController();
    ac.abort();
    const o = buildAgentOptions(config, { ...baseOptions, signal: ac.signal });
    expect(o.abortController?.signal.aborted).toBe(true);
  });

  test("no signal means no abortController", () => {
    const o = buildAgentOptions(config, baseOptions);
    expect(o.abortController).toBeUndefined();
  });
});
