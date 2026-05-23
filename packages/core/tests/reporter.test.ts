import { describe, expect, test } from "bun:test";
import { formatCheckJSON, formatCheckReport } from "../src/reporter.js";
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

function makeTrapReport(): CheckReport {
  return {
    ...makeReport(),
    scenarios: [
      {
        scenario: {
          name: "Error handling",
          prompt: "How do I get error messages?",
          requiredSources: ["readme", "llms"],
        },
        answerable: "NO",
        confidence: 0,
        response: "Use ZodError.format().\n\n## Sources\n- [readme]\n- [llms]",
        reason: 'Trap fired: "old_v2_api" (Deprecated in Zod 4)',
        citations: {
          cited: ["readme", "llms"],
          required: ["readme", "llms"],
          missing: [],
          unknown: [],
        },
        traps: {
          fired: [
            {
              id: "old_v2_api",
              reason: "Deprecated in Zod 4; use z.treeifyError()",
              matched: "ZodError.format()",
              snippet: "Use ZodError.format().",
            },
          ],
          avoided: [],
        },
      },
    ],
    summary: { total: 1, answered: 0, unanswered: 1, score: 0 },
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

  test("strips verifierSamples content in non-verbose mode", () => {
    const base = makeReport();
    const first = base.scenarios[0];
    if (!first) throw new Error("makeReport should produce a scenario");
    const reportWithVerifier: CheckReport = {
      ...base,
      scenarios: [
        {
          ...first,
          verifierSamples: [
            {
              id: "readme",
              name: "README.md",
              content: "SECRET CONTENT IN VERIFIER",
            },
          ],
        },
      ],
    };
    const slim = formatCheckJSON(reportWithVerifier);
    expect(slim).not.toContain("SECRET CONTENT IN VERIFIER");
    const parsed = JSON.parse(slim);
    expect(parsed.scenarios[0].verifierSamples[0].content).toBe("");
    expect(parsed.scenarios[0].verifierSamples[0].id).toBe("readme");
  });

  test("verbose mode preserves verifierSamples content", () => {
    const base = makeReport();
    const first = base.scenarios[0];
    if (!first) throw new Error("makeReport should produce a scenario");
    const reportWithVerifier: CheckReport = {
      ...base,
      scenarios: [
        {
          ...first,
          verifierSamples: [
            {
              id: "readme",
              name: "README.md",
              content: "SECRET CONTENT IN VERIFIER",
            },
          ],
        },
      ],
    };
    const verbose = formatCheckJSON(reportWithVerifier, { verbose: true });
    expect(verbose).toContain("SECRET CONTENT IN VERIFIER");
  });
});

describe("formatCheckReport", () => {
  test("uses the shared terminal feedback grammar for passing reports", () => {
    const text = formatCheckReport(makeReport(), { threshold: 80 });
    expect(text).toContain("pickled check");
    expect(text).toContain("Tool: t");
    expect(text).toContain("Sources: [readme]");
    expect(text).toContain("Scenario: s");
    expect(text).toContain("✓ Well grounded (100%)");
    expect(text).toContain("cited: [readme]");
    expect(text).toContain("Overall: 100 / 100 · threshold 80 · run passes");
    expect(text).not.toContain("🥒");
  });

  test("prints trap evidence before the overall failure", () => {
    const text = formatCheckReport(makeTrapReport(), { threshold: 80 });
    expect(text).toContain("Scenario: Error handling");
    expect(text).toContain("✗ Trap fired (0%)");
    expect(text).toContain("trap: old_v2_api");
    expect(text).toContain("reason: Deprecated in Zod 4; use z.treeifyError()");
    expect(text).toContain('match: "ZodError.format()"');
    expect(text).toContain("cited: [readme], [llms]");
    expect(text).toContain("Overall: 0 / 100 · threshold 80 · run fails");
    expect(text).toContain("Review fired traps before trusting this surface.");
  });

  test("PARTIAL at high confidence still renders Partially grounded, not Well grounded", () => {
    const base = makeReport();
    const baseScenario = base.scenarios[0];
    if (!baseScenario) throw new Error("makeReport should produce a scenario");
    const report = {
      ...base,
      scenarios: [
        {
          ...baseScenario,
          answerable: "PARTIAL" as const,
          confidence: 95,
        },
      ],
    };
    const text = formatCheckReport(report);
    expect(text).toContain("⚠ Partially grounded (95%)");
    expect(text).not.toContain("Well grounded (95%)");
  });

  test("no threshold renders Overall without pass/fail language", () => {
    const text = formatCheckReport(makeReport());
    expect(text).toContain("Overall: 100 / 100");
    expect(text).not.toContain("run passes");
    expect(text).not.toContain("run fails");
    expect(text).not.toContain("threshold");
  });
});

// AIDEV-NOTE: Golden output fixtures for formatCheckReport. ANSI is stripped
// before comparison so cosmetic color changes do not break the assertions;
// structural changes (label, ordering, threshold line presence) do. Update
// with `bun test -u` when intentional, but eyeball the diff first.

function stripAnsi(text: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

describe("formatCheckReport golden fixtures", () => {
  test("well grounded, no threshold (omits run passes/fails)", () => {
    expect(stripAnsi(formatCheckReport(makeReport()))).toMatchSnapshot();
  });

  test("threshold pass: well grounded with threshold 80", () => {
    expect(
      stripAnsi(formatCheckReport(makeReport(), { threshold: 80 })),
    ).toMatchSnapshot();
  });

  test("partially grounded scenario", () => {
    const base = makeReport();
    const first = base.scenarios[0];
    if (!first) throw new Error("makeReport should produce a scenario");
    const report: CheckReport = {
      ...base,
      scenarios: [{ ...first, answerable: "PARTIAL", confidence: 65 }],
      summary: { ...base.summary, score: 33 },
    };
    expect(stripAnsi(formatCheckReport(report))).toMatchSnapshot();
  });

  test("trap fired with threshold (run fails)", () => {
    expect(
      stripAnsi(formatCheckReport(makeTrapReport(), { threshold: 80 })),
    ).toMatchSnapshot();
  });

  test("ungrounded scenario (NO, no trap, missing citation)", () => {
    const base = makeReport();
    const first = base.scenarios[0];
    if (!first) throw new Error("makeReport should produce a scenario");
    const report: CheckReport = {
      ...base,
      scenarios: [
        {
          ...first,
          answerable: "NO",
          confidence: 0,
          reason: "No required sources cited",
          citations: {
            cited: [],
            required: ["readme"],
            missing: ["readme"],
            unknown: [],
          },
        },
      ],
      summary: { ...base.summary, score: 0, answered: 0, unanswered: 1 },
    };
    expect(stripAnsi(formatCheckReport(report))).toMatchSnapshot();
  });

  test("matrix targets: same scenario run against two targets", () => {
    const base = makeReport();
    const first = base.scenarios[0];
    if (!first) throw new Error("makeReport should produce a scenario");
    const matrixScenario = {
      ...first,
      scenario: { ...first.scenario, name: "Installation" },
    };
    const report: CheckReport = {
      ...base,
      scenarios: [
        {
          ...matrixScenario,
          target: {
            target: "quick",
            category: "cli",
            provider: "claude-code",
            model: "haiku",
          },
        },
        {
          ...matrixScenario,
          target: {
            target: "thorough",
            category: "cli",
            provider: "claude-code",
            model: "sonnet",
          },
        },
      ],
      summary: { total: 2, answered: 2, unanswered: 0, score: 100 },
    };
    expect(stripAnsi(formatCheckReport(report))).toMatchSnapshot();
  });
});
