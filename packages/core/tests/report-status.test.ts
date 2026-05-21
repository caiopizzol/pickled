import { describe, expect, test } from "bun:test";
import { getScenarioStatus } from "../src/report-status.js";
import type { ScenarioResult } from "../src/types.js";

function makeResult(overrides: Partial<ScenarioResult> = {}): ScenarioResult {
  return {
    scenario: { name: "s", prompt: "p", requiredSources: [] },
    answerable: "YES",
    confidence: 100,
    response: "",
    reason: "",
    citations: { cited: [], required: [], missing: [], unknown: [] },
    traps: { fired: [], avoided: [] },
    ...overrides,
  };
}

describe("getScenarioStatus", () => {
  test("YES + 90 renders Well grounded", () => {
    const status = getScenarioStatus(
      makeResult({ answerable: "YES", confidence: 90 }),
    );
    expect(status.label).toBe("Well grounded");
    expect(status.icon).toBe("✓");
    expect(status.tone).toBe("success");
  });

  test("YES + 89 renders Grounded", () => {
    const status = getScenarioStatus(
      makeResult({ answerable: "YES", confidence: 89 }),
    );
    expect(status.label).toBe("Grounded");
    expect(status.icon).toBe("✓");
    expect(status.tone).toBe("success");
  });

  test("PARTIAL + 95 renders Partially grounded (categorical wins over confidence)", () => {
    const status = getScenarioStatus(
      makeResult({ answerable: "PARTIAL", confidence: 95 }),
    );
    expect(status.label).toBe("Partially grounded");
    expect(status.icon).toBe("⚠");
    expect(status.tone).toBe("warning");
  });

  test("trap fired with high confidence still renders Trap fired", () => {
    const status = getScenarioStatus(
      makeResult({
        answerable: "YES",
        confidence: 100,
        traps: {
          fired: [
            {
              id: "old_api",
              reason: "Deprecated",
              matched: "old()",
              snippet: "old()",
            },
          ],
          avoided: [],
        },
      }),
    );
    expect(status.label).toBe("Trap fired");
    expect(status.icon).toBe("✗");
    expect(status.tone).toBe("error");
  });

  test("NO renders Ungrounded", () => {
    const status = getScenarioStatus(
      makeResult({ answerable: "NO", confidence: 0 }),
    );
    expect(status.label).toBe("Ungrounded");
    expect(status.tone).toBe("error");
  });

  test("error result renders Error and overrides everything", () => {
    const status = getScenarioStatus(
      makeResult({
        answerable: "YES",
        confidence: 100,
        error: "Target crashed",
      }),
    );
    expect(status.label).toBe("Error");
    expect(status.tone).toBe("error");
  });
});
