import { describe, expect, test } from "bun:test";
import { resolveContext, resolveTarget } from "../../src/targets/index.js";

describe("resolveTarget", () => {
  test('treats "default" as sentinel - no throw', () => {
    expect(() => resolveTarget("default", undefined)).not.toThrow();
  });

  test("treats undefined as sentinel - no throw", () => {
    expect(() => resolveTarget(undefined, undefined)).not.toThrow();
  });

  test("throws when named ref is unknown", () => {
    expect(() => resolveTarget("nonexistent", undefined)).toThrow(
      /Unknown target "nonexistent"/,
    );
  });

  test("returns the named target when declared", () => {
    const { name } = resolveTarget("quick", {
      quick: { category: "cli", provider: "claude-code" },
    });
    expect(name).toBe("quick");
  });
});

describe("resolveContext", () => {
  test('treats "default" as sentinel - no throw', () => {
    expect(() => resolveContext("default", undefined)).not.toThrow();
  });

  test("treats undefined as sentinel - no throw", () => {
    expect(() => resolveContext(undefined, undefined)).not.toThrow();
  });

  test("throws when named ref is unknown", () => {
    expect(() => resolveContext("nonexistent", undefined)).toThrow(
      /Unknown context "nonexistent"/,
    );
  });

  test("returns the named context when declared", () => {
    const { name } = resolveContext("ide", {
      ide: { allowedTools: ["Read"] },
    });
    expect(name).toBe("ide");
  });
});
