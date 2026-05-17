import { describe, expect, test } from "bun:test";
import { resolveContext, resolveTarget } from "../../src/targets/index.js";

const originalWarn = console.warn;

function captureWarnings(fn: () => void): string[] {
  const captured: string[] = [];
  console.warn = (...args: unknown[]) => {
    captured.push(args.map(String).join(" "));
  };
  try {
    fn();
  } finally {
    console.warn = originalWarn;
  }
  return captured;
}

describe("resolveTarget", () => {
  test('treats "default" as sentinel - no warning', () => {
    const warnings = captureWarnings(() => {
      resolveTarget("default", undefined);
    });
    expect(warnings).toEqual([]);
  });

  test("treats undefined as sentinel - no warning", () => {
    const warnings = captureWarnings(() => {
      resolveTarget(undefined, undefined);
    });
    expect(warnings).toEqual([]);
  });

  test("warns when named ref is unknown", () => {
    const warnings = captureWarnings(() => {
      resolveTarget("nonexistent", undefined);
    });
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain("nonexistent");
  });
});

describe("resolveContext", () => {
  test('treats "default" as sentinel - no warning', () => {
    const warnings = captureWarnings(() => {
      resolveContext("default", undefined);
    });
    expect(warnings).toEqual([]);
  });

  test("treats undefined as sentinel - no warning", () => {
    const warnings = captureWarnings(() => {
      resolveContext(undefined, undefined);
    });
    expect(warnings).toEqual([]);
  });

  test("warns when named ref is unknown", () => {
    const warnings = captureWarnings(() => {
      resolveContext("nonexistent", undefined);
    });
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain("nonexistent");
  });
});
