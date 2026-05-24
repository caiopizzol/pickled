import { describe, expect, test } from "bun:test";
import {
  resolveThreshold,
  shouldFailThreshold,
} from "../src/commands/check.js";

describe("resolveThreshold", () => {
  test("uses config threshold when CLI option is absent", () => {
    expect(resolveThreshold(undefined, 75)).toBe(75);
  });

  test("rejects invalid config threshold when CLI option is absent", () => {
    expect(() => resolveThreshold(undefined, "nope")).toThrow(
      'Invalid pickled.yml threshold "nope". Expected an integer from 0 to 100.',
    );
  });

  test("rejects fractional config threshold", () => {
    expect(() => resolveThreshold(undefined, 75.5)).toThrow(
      'Invalid pickled.yml threshold "75.5". Expected an integer from 0 to 100.',
    );
  });

  test("defaults to 0 when no threshold is configured", () => {
    expect(resolveThreshold(undefined, undefined)).toBe(0);
  });

  test("allows CLI threshold 0 to disable a configured threshold", () => {
    expect(resolveThreshold("0", 75)).toBe(0);
  });

  test("accepts integer CLI thresholds through 100", () => {
    expect(resolveThreshold("100", undefined)).toBe(100);
  });

  test("rejects non-numeric CLI thresholds", () => {
    expect(() => resolveThreshold("nope", 75)).toThrow(
      'Invalid --threshold "nope". Expected an integer from 0 to 100.',
    );
  });

  test("rejects partial numeric CLI thresholds", () => {
    expect(() => resolveThreshold("80abc", undefined)).toThrow(
      'Invalid --threshold "80abc". Expected an integer from 0 to 100.',
    );
  });

  test("rejects CLI thresholds above 100", () => {
    expect(() => resolveThreshold("101", undefined)).toThrow(
      'Invalid --threshold "101". Expected an integer from 0 to 100.',
    );
  });
});

describe("shouldFailThreshold", () => {
  test("score below configured threshold fails", () => {
    expect(shouldFailThreshold({ plan: false, threshold: 60, score: 34 })).toBe(
      true,
    );
  });

  test("score at or above configured threshold passes", () => {
    expect(shouldFailThreshold({ plan: false, threshold: 60, score: 60 })).toBe(
      false,
    );
    expect(
      shouldFailThreshold({ plan: false, threshold: 60, score: 100 }),
    ).toBe(false);
  });

  test("threshold 0 (unset) always passes regardless of score", () => {
    expect(shouldFailThreshold({ plan: false, threshold: 0, score: 0 })).toBe(
      false,
    );
  });

  test("plan: true forces pass even when score < threshold (regression for --plan)", () => {
    // A dry-run report has scenarios: [] and summary.score: 0; the
    // threshold gate must not apply or `--plan` could not coexist with
    // a configured `threshold:` in pickled.yml.
    expect(shouldFailThreshold({ plan: true, threshold: 60, score: 0 })).toBe(
      false,
    );
    expect(shouldFailThreshold({ plan: true, threshold: 100, score: 50 })).toBe(
      false,
    );
  });
});
