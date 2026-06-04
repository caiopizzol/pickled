import { describe, expect, test } from "bun:test";
import { formatJSON, formatReport } from "../src/reporter.js";
import type { RunReport } from "../src/types.js";

function questionReport(over: Partial<RunReport> = {}): RunReport {
  return {
    product: { name: "demo", description: "d" },
    sources: [
      {
        id: "docs",
        type: "url",
        source: "https://x/llms.txt",
        content: "SECRET CONTENT",
        name: "llms.txt",
      },
    ],
    facts: { install: { statement: "install", match: { allOf: ["bunx"] } } },
    misstatements: {},
    kind: "questions",
    questions: [
      {
        id: "q1",
        question: "how to install?",
        cells: [
          {
            coord: { agent: "a", context: "mem" },
            mode: "memory",
            source: null,
            verdict: "YES",
            passedTrials: 1,
            totalTrials: 1,
            passRate: 100,
            meanCoverage: 100,
            trials: [
              {
                status: "scored",
                verdict: "YES",
                passed: true,
                coverage: 100,
                factsCovered: ["install"],
                factsMissed: [],
                misstatementsHit: [],
                provenanceOk: true,
                toolsUsed: [],
                response: "bunx demo",
                allResponses: [{ type: "final", text: "bunx demo" }],
              },
            ],
            reason: "all expected facts covered",
          },
          {
            coord: { agent: "a", context: "web" },
            mode: "web",
            source: "docs",
            verdict: "PARTIAL",
            passedTrials: 0,
            totalTrials: 1,
            passRate: 0,
            meanCoverage: 50,
            trials: [],
            reason: "missing facts: cmd",
          },
        ],
      },
    ],
    summary: { total: 2, yes: 1, partial: 1, no: 0, errors: 0, score: 75 },
    threshold: 80,
    ...over,
  };
}

describe("formatReport (terminal)", () => {
  test("renders header, per-cell labels, and the run verdict", () => {
    const out = formatReport(questionReport());
    expect(out).toContain("pickled check");
    expect(out).toContain("Product: demo");
    expect(out).toContain("Task: how to install?");
    expect(out).toContain("Well grounded 1/1");
    expect(out).toContain("Partially grounded 0/1");
    expect(out).toContain("50% facts");
    expect(out).toContain("Overall: 75 / 100");
    expect(out).toContain("threshold 80");
    expect(out).toContain("run fails");
  });

  test("no threshold -> shows Overall and stops (no run pass/fail)", () => {
    const out = formatReport(questionReport({ threshold: undefined }));
    expect(out).toContain("Overall: 75 / 100");
    expect(out).not.toContain("run fails");
    expect(out).not.toContain("run passes");
  });

  test("errored cells surface in the Overall line and fail a thresholded run", () => {
    const out = formatReport(
      questionReport({
        summary: { total: 2, yes: 1, partial: 0, no: 0, errors: 1, score: 100 },
      }),
    );
    expect(out).toContain("1 errored");
    expect(out).toContain("run fails");
  });
});

describe("formatJSON", () => {
  test("slim output strips source content and per-trial transcripts", () => {
    const json = JSON.parse(formatJSON(questionReport()));
    expect(json.sources[0].content).toBe("");
    expect(json.questions[0].cells[0].trials[0].allResponses).toBeUndefined();
    // machine fields stay raw
    expect(json.questions[0].cells[0].verdict).toBe("YES");
    expect(json.summary.score).toBe(75);
  });

  test("verbose output keeps content", () => {
    const json = JSON.parse(formatJSON(questionReport(), { verbose: true }));
    expect(json.sources[0].content).toBe("SECRET CONTENT");
  });
});
