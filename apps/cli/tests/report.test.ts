import { describe, expect, test } from "bun:test";
import type { RunReport } from "@pickled-dev/core";
import {
  parseReport,
  renderSaved,
  resolveReportFormat,
} from "../src/commands/report.js";

/**
 * `pickled report` re-renders a saved receipt. These cover the pure pieces:
 * format resolution, receipt validation, and per-format dispatch. The IO and
 * process.exit paths live in the action and are exercised by hand / in CI.
 */

function questionReceipt(): RunReport {
  return {
    product: { name: "demo", description: "d" },
    sources: [],
    facts: {},
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
                response: "SECRET ANSWER",
              },
            ],
            reason: "ok",
          },
        ],
      },
    ],
    summary: { total: 1, yes: 1, partial: 0, no: 0, errors: 0, score: 100 },
  };
}

describe("resolveReportFormat", () => {
  test("defaults to terminal", () => {
    expect(resolveReportFormat({})).toBe("terminal");
  });

  test("--json is shorthand for json", () => {
    expect(resolveReportFormat({ json: true })).toBe("json");
  });

  test("explicit --format wins over --json", () => {
    expect(resolveReportFormat({ format: "markdown", json: true })).toBe(
      "markdown",
    );
  });
});

describe("parseReport", () => {
  test("accepts a saved question receipt", () => {
    const parsed = parseReport(JSON.stringify(questionReceipt()));
    expect(parsed.kind).toBe("questions");
  });

  test("rejects non-JSON", () => {
    expect(() => parseReport("not json")).toThrow(/Not valid JSON/);
  });

  test("rejects JSON that is not a Pickled report", () => {
    expect(() => parseReport(JSON.stringify({ hello: "world" }))).toThrow(
      /Not a Pickled report/,
    );
  });

  // The shallow check shipped earlier let these through: terminal then crashed
  // with a stack trace and markdown rendered "Overall: undefined / 100".
  test("rejects a receipt with kind but no product", () => {
    expect(() => parseReport('{"kind":"questions","summary":{}}')).toThrow(
      /missing `product.name`/,
    );
  });

  test("rejects a receipt with a non-numeric summary", () => {
    expect(() =>
      parseReport(
        JSON.stringify({
          kind: "questions",
          product: { name: "x" },
          sources: [],
          facts: {},
          misstatements: {},
          summary: {},
          questions: [],
        }),
      ),
    ).toThrow(/`summary\.total` must be a number/);
  });

  test("rejects a question receipt missing its questions array", () => {
    const ok = questionReceipt() as Record<string, unknown>;
    delete ok.questions;
    expect(() => parseReport(JSON.stringify(ok))).toThrow(
      /`questions` must be an array/,
    );
  });

  test("rejects a malformed cell (no coord)", () => {
    const bad = questionReceipt();
    // biome-ignore lint/suspicious/noExplicitAny: deliberately corrupting the shape
    (bad.questions as any)[0].cells[0].coord = undefined;
    expect(() => parseReport(JSON.stringify(bad))).toThrow(/missing `coord/);
  });
});

describe("renderSaved", () => {
  test("json re-slims by default (the sanitize path)", () => {
    const out = renderSaved(questionReceipt(), "json", false);
    expect(out).not.toContain("SECRET ANSWER");
  });

  test("json --verbose keeps full answers", () => {
    const out = renderSaved(questionReceipt(), "json", true);
    expect(out).toContain("SECRET ANSWER");
  });

  test("markdown never carries full answers", () => {
    const out = renderSaved(questionReceipt(), "markdown", false);
    expect(out).not.toContain("SECRET ANSWER");
    expect(out).toContain("# pickled check");
  });
});
