import { describe, expect, test } from "bun:test";
import {
  buildCellStatus,
  questionCellStatus,
  runPasses,
  summarizeBuilds,
  summarizeQuestions,
} from "../src/report-status.js";
import type { BuildCell, QuestionCell } from "../src/types.js";

function qCell(over: Partial<QuestionCell>): QuestionCell {
  return {
    coord: { agent: "a", context: "c" },
    mode: "memory",
    source: null,
    verdict: "YES",
    passedTrials: 1,
    totalTrials: 1,
    passRate: 100,
    meanCoverage: 100,
    trials: [],
    reason: "",
    ...over,
  };
}

function bCell(over: Partial<BuildCell>): BuildCell {
  return {
    coord: { agent: "a", context: "c" },
    mode: "memory",
    source: null,
    verdict: "YES",
    passedAttempts: 1,
    totalAttempts: 1,
    passRate: 100,
    attempts: [],
    reason: "",
    verifierProof: "not_declared",
    ...over,
  };
}

describe("questionCellStatus - label from verdict", () => {
  test("YES -> Well grounded", () => {
    expect(questionCellStatus(qCell({ verdict: "YES" })).label).toBe(
      "Well grounded",
    );
  });
  test("PARTIAL -> Partially grounded with coverage detail", () => {
    const s = questionCellStatus(
      qCell({ verdict: "PARTIAL", meanCoverage: 60, passedTrials: 0 }),
    );
    expect(s.label).toBe("Partially grounded");
    expect(s.detail).toBe("60% facts");
    expect(s.rate).toBe("0/1");
  });
  test("NO -> Ungrounded", () => {
    expect(questionCellStatus(qCell({ verdict: "NO" })).label).toBe(
      "Ungrounded",
    );
  });
  test("error -> Error", () => {
    expect(questionCellStatus(qCell({ error: "x", verdict: "NO" })).label).toBe(
      "Error",
    );
  });
  test("a high pass-rate PARTIAL never upgrades to Well grounded", () => {
    const s = questionCellStatus(
      qCell({
        verdict: "PARTIAL",
        passRate: 95,
        passedTrials: 19,
        totalTrials: 20,
      }),
    );
    expect(s.label).toBe("Partially grounded");
  });
});

describe("buildCellStatus", () => {
  test("YES -> Built", () => {
    expect(buildCellStatus(bCell({ verdict: "YES" })).label).toBe("Built");
  });
  test("PARTIAL -> Partially built", () => {
    expect(buildCellStatus(bCell({ verdict: "PARTIAL" })).label).toBe(
      "Partially built",
    );
  });
  test("NO -> Did not build", () => {
    expect(buildCellStatus(bCell({ verdict: "NO" })).label).toBe(
      "Did not build",
    );
  });
  test("not_declared verifier surfaces 'verifier unproven'", () => {
    expect(
      buildCellStatus(bCell({ verifierProof: "not_declared" })).detail,
    ).toBe("verifier unproven");
  });
  test("a failed reference solution surfaces a broken-verifier detail", () => {
    const s = buildCellStatus(
      bCell({ error: "x", verifierProof: "failed", verdict: "NO" }),
    );
    expect(s.label).toBe("Error");
    expect(s.detail).toContain("verifier broken");
  });
});

describe("summarize", () => {
  test("questions: counts + score = mean meanCoverage over non-error cells", () => {
    const s = summarizeQuestions([
      qCell({ verdict: "YES", meanCoverage: 100 }),
      qCell({ verdict: "PARTIAL", meanCoverage: 50 }),
      qCell({ verdict: "NO", error: "x", meanCoverage: 0 }),
    ]);
    expect(s).toMatchObject({ total: 3, yes: 1, partial: 1, no: 0, errors: 1 });
    expect(s.score).toBe(75); // (100 + 50) / 2 over the 2 scored cells
  });

  test("builds: score = mean passRate over non-error cells", () => {
    const s = summarizeBuilds([
      bCell({ verdict: "YES", passRate: 100 }),
      bCell({ verdict: "NO", passRate: 0 }),
    ]);
    expect(s.score).toBe(50);
    expect(s).toMatchObject({ total: 2, yes: 1, no: 1, errors: 0 });
  });
});

describe("runPasses", () => {
  test("null when no threshold configured", () => {
    expect(
      runPasses(
        { total: 1, yes: 1, partial: 0, no: 0, errors: 0, score: 100 },
        undefined,
      ),
    ).toBeNull();
  });
  test("passes when score meets threshold and no errors", () => {
    expect(
      runPasses(
        { total: 1, yes: 1, partial: 0, no: 0, errors: 0, score: 90 },
        80,
      ),
    ).toBe(true);
  });
  test("fails when score below threshold", () => {
    expect(
      runPasses(
        { total: 1, yes: 0, partial: 0, no: 1, errors: 0, score: 40 },
        80,
      ),
    ).toBe(false);
  });
  test("a thresholded run with any errored cell fails even at score 100", () => {
    expect(
      runPasses(
        { total: 2, yes: 1, partial: 0, no: 0, errors: 1, score: 100 },
        80,
      ),
    ).toBe(false);
  });
});
