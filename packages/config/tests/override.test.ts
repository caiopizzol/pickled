import { describe, expect, test } from "bun:test";
import { overrideTarget } from "../src/override.js";
import type { CheckConfig, Scenario } from "../src/types.js";

function scenario(name: string, target?: string): Scenario {
  return {
    name,
    prompt: `prompt for ${name}`,
    requiredSources: [],
    ...(target ? { target } : {}),
  };
}

function baseConfig(overrides: Partial<CheckConfig> = {}): CheckConfig {
  return {
    tool: { name: "t", description: "d" },
    targets: {
      quick: { category: "cli", provider: "claude-code" },
      thorough: { category: "cli", provider: "claude-code" },
      codex: { category: "cli", provider: "codex-cli", model: "gpt-5.5" },
    },
    matrix: { target: ["quick", "codex"] },
    scenarios: [scenario("a"), scenario("b")],
    ...overrides,
  };
}

describe("overrideTarget", () => {
  test("narrows matrix.target to the named target", () => {
    const result = overrideTarget(baseConfig(), "quick");
    expect(result.matrix?.target).toEqual(["quick"]);
  });

  test("keeps scenarios with no explicit target", () => {
    const result = overrideTarget(baseConfig(), "quick");
    expect(result.scenarios.map((s) => s.name)).toEqual(["a", "b"]);
  });

  test("keeps scenarios whose explicit target matches the override", () => {
    const config = baseConfig({
      scenarios: [scenario("a"), scenario("b", "quick")],
    });
    const result = overrideTarget(config, "quick");
    expect(result.scenarios.map((s) => s.name)).toEqual(["a", "b"]);
  });

  test("drops scenarios whose explicit target does not match", () => {
    const config = baseConfig({
      scenarios: [
        scenario("matrix-runs"),
        scenario("codex-only", "codex"),
        scenario("quick-explicit", "quick"),
      ],
    });
    const result = overrideTarget(config, "quick");
    expect(result.scenarios.map((s) => s.name)).toEqual([
      "matrix-runs",
      "quick-explicit",
    ]);
  });

  test("throws on unknown target with available list", () => {
    expect(() => overrideTarget(baseConfig(), "nonexistent")).toThrow(
      /Unknown target: "nonexistent"\. Available targets: codex, default, quick, thorough/,
    );
  });

  test("accepts the 'default' sentinel even when not in config.targets", () => {
    const result = overrideTarget(baseConfig(), "default");
    expect(result.matrix?.target).toEqual(["default"]);
  });

  test("does not mutate the input config", () => {
    const config = baseConfig();
    const originalMatrix = config.matrix?.target;
    const originalScenarios = config.scenarios;
    overrideTarget(config, "quick");
    expect(config.matrix?.target).toBe(originalMatrix);
    expect(config.scenarios).toBe(originalScenarios);
  });
});
