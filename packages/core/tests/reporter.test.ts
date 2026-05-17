import { describe, expect, test } from "bun:test";
import { formatCheckJSON } from "../src/reporter.js";
import type { CheckReport } from "../src/types.js";

function makeReport(): CheckReport {
  return {
    tool: { name: "t", description: "d", path: "/tmp/t" },
    docs: [
      {
        id: "readme",
        source: "./README.md",
        content: "BIG SECRET CONTENT".repeat(1000),
        name: "README.md",
        type: "file",
      },
    ],
    scenarios: [
      {
        scenario: {
          name: "s",
          prompt: "p",
          requiredSources: ["readme"],
        },
        answerable: "YES",
        confidence: 100,
        response: "Answer.\n\n## Sources\n- [readme]",
        reason: "All required sources cited: readme",
        citations: {
          cited: ["readme"],
          required: ["readme"],
          missing: [],
          unknown: [],
        },
        traps: { fired: [], avoided: [] },
        allResponses: [
          { type: "initial", text: "initial draft" },
          { type: "final", text: "final answer" },
        ],
      },
    ],
    summary: { total: 1, answered: 1, unanswered: 0, score: 100 },
  };
}

describe("formatCheckJSON", () => {
  test("omits source content by default", () => {
    const json = formatCheckJSON(makeReport());
    expect(json).not.toContain("BIG SECRET CONTENT");
    const parsed = JSON.parse(json);
    expect(parsed.docs[0].id).toBe("readme");
    expect(parsed.docs[0].content).toBe("");
  });

  test("omits allResponses by default", () => {
    const json = formatCheckJSON(makeReport());
    const parsed = JSON.parse(json);
    expect(parsed.scenarios[0].allResponses).toBeUndefined();
  });

  test("verbose includes content and allResponses", () => {
    const json = formatCheckJSON(makeReport(), { verbose: true });
    expect(json).toContain("BIG SECRET CONTENT");
    const parsed = JSON.parse(json);
    expect(parsed.scenarios[0].allResponses).toHaveLength(2);
  });

  test("preserves citation details in both modes", () => {
    for (const verbose of [false, true]) {
      const json = formatCheckJSON(makeReport(), { verbose });
      const parsed = JSON.parse(json);
      expect(parsed.scenarios[0].citations.cited).toEqual(["readme"]);
    }
  });
});
