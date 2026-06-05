import { describe, expect, test } from "bun:test";
import {
  formatBuildProof,
  formatJSON,
  formatMarkdown,
  formatReport,
} from "../src/reporter.js";
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
  test("slim output strips source content, full answers, and transcripts", () => {
    const json = JSON.parse(formatJSON(questionReport()));
    const trial = json.questions[0].cells[0].trials[0];
    expect(json.sources[0].content).toBe("");
    expect(trial.allResponses).toBeUndefined();
    // An agent answer can reproduce injected docs, so it is CI-unsafe too.
    expect(trial.response).toBeUndefined();
    // machine fields stay raw
    expect(json.questions[0].cells[0].verdict).toBe("YES");
    expect(trial.coverage).toBe(100);
    expect(json.summary.score).toBe(75);
  });

  test("verbose output keeps content and full answers", () => {
    const json = JSON.parse(formatJSON(questionReport(), { verbose: true }));
    expect(json.sources[0].content).toBe("SECRET CONTENT");
    expect(json.questions[0].cells[0].trials[0].response).toBe("bunx demo");
  });
});

function buildReport(over: Partial<RunReport> = {}): RunReport {
  return {
    product: { name: "demo", description: "d" },
    sources: [],
    facts: {},
    misstatements: {},
    kind: "builds",
    builds: [
      {
        id: "b1",
        goal: "add the widget",
        cells: [
          {
            coord: { agent: "a", context: "repo" },
            mode: "memory",
            source: null,
            verdict: "NO",
            passedAttempts: 0,
            totalAttempts: 1,
            passRate: 0,
            verifierProof: "passed",
            reason: "verifier failed",
            attempts: [
              {
                status: "failed",
                reason: "a failing verify command",
                changedFiles: [{ status: "M", path: "src/widget.ts" }],
                diff: "SECRET DIFF",
                commands: [
                  {
                    group: "failToPass",
                    name: "test",
                    run: "bun test",
                    exitCode: 1,
                    passed: false,
                    stdout: "SECRET STDOUT",
                    stderr: "SECRET STDERR",
                    timedOut: false,
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
    summary: { total: 1, yes: 0, partial: 0, no: 1, errors: 0, score: 0 },
    threshold: 80,
    ...over,
  };
}

describe("formatMarkdown", () => {
  test("questions: overall, summary table, and resolved diagnostics", () => {
    const report = questionReport({
      questions: [
        {
          id: "q1",
          question: "how to install?",
          cells: [
            {
              coord: { agent: "a", context: "web" },
              mode: "web",
              source: "docs",
              verdict: "NO",
              passedTrials: 0,
              totalTrials: 1,
              passRate: 0,
              meanCoverage: 0,
              trials: [
                {
                  status: "scored",
                  verdict: "NO",
                  passed: false,
                  coverage: 0,
                  factsCovered: [],
                  factsMissed: ["install"],
                  misstatementsHit: [],
                  provenanceOk: false,
                  toolsUsed: [],
                  response: "SECRET ANSWER",
                  allResponses: [{ type: "final", text: "SECRET ANSWER" }],
                },
              ],
              reason: "tool path not used",
            },
          ],
        },
      ],
      summary: { total: 1, yes: 0, partial: 0, no: 1, errors: 0, score: 0 },
    });
    const md = formatMarkdown(report);
    expect(md).toContain("# pickled check");
    expect(md).toContain("**Overall: 0 / 100**");
    expect(md).toContain("run fails");
    expect(md).toContain("| Ungrounded | 1 |");
    // Fact id resolves to its statement, not the bare id.
    expect(md).toContain("missing fact: `install` install");
    expect(md).toContain("provenance:");
    // Public-safe: the full agent answer never appears.
    expect(md).not.toContain("SECRET ANSWER");
  });

  test("builds: per-attempt status, changed files, and command exit codes", () => {
    const md = formatMarkdown(buildReport());
    expect(md).toContain("# pickled build");
    expect(md).toContain("| Did not build | 1 |");
    expect(md).toContain("attempt 1: failed");
    expect(md).toContain("test (failToPass, exit 1)");
    expect(md).toContain("M src/widget.ts");
    // Public-safe: diffs and command output never appear.
    expect(md).not.toContain("SECRET DIFF");
    expect(md).not.toContain("SECRET STDOUT");
  });

  test("no threshold: shows the score and no run pass/fail", () => {
    const md = formatMarkdown(questionReport({ threshold: undefined }));
    expect(md).toContain("**Overall: 75 / 100**");
    expect(md).not.toContain("run fails");
    expect(md).not.toContain("run passes");
  });
});

describe("formatBuildProof (--verify-only)", () => {
  test("one line per build with proof status; no scores or run verdict", () => {
    const out = formatBuildProof("demo", [
      { id: "react_embed", goal: "g1", status: "proven" },
      { id: "cli_mutation", goal: "g2", status: "unproven" },
      {
        id: "broken_fix",
        goal: "g3",
        status: "broken",
        message: "failToPass already passes on the untouched workspace",
      },
    ]);
    expect(out).toContain("pickled build --verify-only");
    expect(out).toContain("Product: demo");
    expect(out).toContain("Build verifier proof: 3");
    expect(out).toContain("react_embed");
    expect(out).toContain("proven");
    expect(out).toContain("unproven");
    expect(out).toContain("broken");
    expect(out).toContain("failToPass already passes");
    expect(out).toContain("1 proven · 1 unproven · 1 broken");
    // The proof view never carries k/n scores or a run verdict.
    expect(out).not.toContain("Overall");
  });
});
