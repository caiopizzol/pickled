import { describe, expect, test } from "bun:test";
import { resolveThreshold } from "../src/commands/check.js";

/**
 * resolveThreshold computes the effective per-kind gate: the CLI `--threshold`
 * wins; otherwise the per-kind config value (already validated 1-100 or
 * undefined). Undefined means no gate. The run pass/fail decision itself lives
 * in core's `runPasses` (tested in packages/core/tests/report-status.test.ts).
 */
describe("resolveThreshold", () => {
  test("uses the config threshold when the CLI option is absent", () => {
    expect(resolveThreshold(undefined, 75)).toBe(75);
  });

  test("undefined config + no CLI option -> undefined (no gate)", () => {
    expect(resolveThreshold(undefined, undefined)).toBeUndefined();
  });

  test("a CLI threshold overrides the config value", () => {
    expect(resolveThreshold("90", 75)).toBe(90);
  });

  test("accepts CLI thresholds through 100", () => {
    expect(resolveThreshold("100", undefined)).toBe(100);
  });

  test("rejects CLI threshold 0 (omit the key for no gate)", () => {
    expect(() => resolveThreshold("0", 75)).toThrow(
      /Invalid --threshold "0". Expected an integer from 1 to 100/,
    );
  });

  test("rejects non-numeric CLI thresholds", () => {
    expect(() => resolveThreshold("nope", 75)).toThrow(
      /Invalid --threshold "nope"/,
    );
  });

  test("rejects partial-numeric CLI thresholds", () => {
    expect(() => resolveThreshold("80abc", undefined)).toThrow(
      /Invalid --threshold "80abc"/,
    );
  });

  test("rejects CLI thresholds above 100", () => {
    expect(() => resolveThreshold("101", undefined)).toThrow(
      /Invalid --threshold "101"/,
    );
  });
});
