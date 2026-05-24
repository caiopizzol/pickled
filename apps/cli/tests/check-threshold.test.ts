import { describe, expect, test } from "bun:test";
import { resolveThreshold } from "../src/commands/check.js";

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
