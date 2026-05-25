import { describe, expect, test } from "bun:test";
import { summarizeReadiness } from "../src/readiness.js";
import type { Answerable } from "../src/scorers/index.js";
import type { CellResult, CheckReport, ScenarioResult } from "../src/types.js";

// ---------------------------------------------------------------------
// Fixtures: hand-roll minimal CheckReport / ScenarioResult / CellResult
// shapes. The summarizer is a pure function over those types; we don't
// need a real runCheck pipeline to exercise the patterns.
// ---------------------------------------------------------------------

function emptyExpected() {
  return {
    includes: [],
    excludes: [],
    symbols: [],
    paths: [],
    options: [],
    constraints: [],
    satisfied: 0,
    total: 0,
  };
}

function cell(args: {
  interface: string;
  source: string | null;
  toolset: string;
  answerable: Answerable;
  expected?: Partial<ReturnType<typeof emptyExpected>>;
  trapsFired?: Array<{ id: string; reason: string }>;
}): CellResult {
  return {
    cell: {
      interface: args.interface,
      source: args.source,
      toolset: args.toolset,
    },
    answerable: args.answerable,
    confidence:
      args.answerable === "YES" ? 100 : args.answerable === "PARTIAL" ? 50 : 0,
    response: "",
    reason: "",
    citations: null,
    traps: {
      fired: args.trapsFired ?? [],
      avoided: [],
    },
    expected: args.expected
      ? { ...emptyExpected(), ...args.expected }
      : undefined,
  };
}

function scenario(name: string, cells: CellResult[]): ScenarioResult {
  return {
    scenario: { name, prompt: "?" },
    answerable: null,
    confidence: null,
    response: null,
    reason: null,
    citations: null,
    traps: null,
    cells,
    target: undefined,
    context: { name: "default" },
  };
}

function report(scenarios: ScenarioResult[]): CheckReport {
  return {
    tool: { name: "t", description: "d", path: "/tmp" },
    docs: [],
    scenarios,
    summary: { total: 0, answered: 0, unanswered: 0, score: 0 },
  };
}

describe("summarizeReadiness", () => {
  test("emits nothing when no scenarios match any pattern", () => {
    const r = report([
      scenario("Plain", [
        cell({
          interface: "a",
          source: "x",
          toolset: "none",
          answerable: "YES",
        }),
      ]),
    ]);
    expect(summarizeReadiness(r).diagnostics).toEqual([]);
  });
});

describe("grouped_check_pass", () => {
  test("emits when every declared grouped key is satisfied", () => {
    const r = report([
      scenario("R", [
        cell({
          interface: "a",
          source: "docs",
          toolset: "none",
          answerable: "YES",
          expected: {
            symbols: [{ value: "X", satisfied: true }],
            options: [
              { value: "p", satisfied: true },
              { value: "q", satisfied: true },
            ],
            satisfied: 3,
            total: 3,
          },
        }),
      ]),
    ]);
    const diags = summarizeReadiness(r).diagnostics;
    expect(diags).toHaveLength(1);
    expect(diags[0]?.pattern).toBe("grouped_check_pass");
    expect(diags[0]?.message).toContain("symbols 1/1");
    expect(diags[0]?.message).toContain("options 2/2");
  });

  test("skipped when only legacy includes/excludes are declared (not a readiness signal)", () => {
    const r = report([
      scenario("Legacy", [
        cell({
          interface: "a",
          source: "docs",
          toolset: "none",
          answerable: "YES",
          expected: {
            includes: [{ value: "x", satisfied: true }],
            satisfied: 1,
            total: 1,
          },
        }),
      ]),
    ]);
    const diags = summarizeReadiness(r).diagnostics.filter(
      (d) => d.pattern === "grouped_check_pass",
    );
    expect(diags).toEqual([]);
  });

  test("emits for single-mode scenarios via ScenarioResult.expected", () => {
    // Regression: an earlier draft only walked scenario.cells; single-
    // mode scenarios (no matrix) carry the grouped fields on
    // ScenarioResult.expected after #21, and the readiness summarizer
    // has to consume both shapes uniformly.
    const r: CheckReport = {
      tool: { name: "t", description: "d", path: "/tmp" },
      docs: [],
      scenarios: [
        {
          scenario: { name: "SingleMode", prompt: "?" },
          answerable: "YES",
          confidence: 100,
          response: "",
          reason: "",
          citations: null,
          traps: null,
          expected: {
            includes: [],
            excludes: [],
            symbols: [{ value: "X", satisfied: true }],
            paths: [],
            options: [{ value: "p", satisfied: true }],
            constraints: [],
            satisfied: 2,
            total: 2,
          },
          target: undefined,
          context: { name: "default" },
        },
      ],
      summary: { total: 1, answered: 1, unanswered: 0, score: 100 },
    };
    const diags = summarizeReadiness(r).diagnostics.filter(
      (d) => d.pattern === "grouped_check_pass",
    );
    expect(diags).toHaveLength(1);
    expect(diags[0]?.scenario).toBe("SingleMode");
    expect(diags[0]?.message).toContain('scenario "SingleMode"');
    expect(diags[0]?.message).toContain("symbols 1/1");
    expect(diags[0]?.message).toContain("options 1/1");
    // Single-mode has no matrix coordinate; cells is empty by design.
    expect(diags[0]?.cells).toEqual([]);
  });

  test("skipped when every positive group is satisfied BUT an exclude was hit (#24)", () => {
    // Regression for #24, surfaced by the first SuperDoc dogfood run.
    // Cell that satisfied symbols + paths but hit an exclude was being
    // labeled "Full readiness signal" while its verdict was PARTIAL.
    // Strict reading of "full readiness": got the right things AND
    // avoided the wrong things.
    const r = report([
      scenario("ExcludeHit", [
        cell({
          interface: "a",
          source: "docs",
          toolset: "none",
          answerable: "PARTIAL",
          expected: {
            symbols: [{ value: "RightAPI", satisfied: true }],
            paths: [{ value: "right/path", satisfied: true }],
            // The exclude was declared but NOT satisfied (i.e. the
            // agent did mention the banned name). The diagnostic
            // must stay silent so it doesn't lie about readiness.
            excludes: [{ value: "deprecatedAPI", satisfied: false }],
            satisfied: 2,
            total: 3,
          },
        }),
      ]),
    ]);
    const diags = summarizeReadiness(r).diagnostics.filter(
      (d) => d.pattern === "grouped_check_pass",
    );
    expect(diags).toEqual([]);
  });

  test("fires when positives are satisfied AND every exclude held", () => {
    // The honest "full readiness" case: agent named the right things
    // (symbols + paths satisfied) AND avoided the wrong things
    // (excludes satisfied).
    const r = report([
      scenario("Clean", [
        cell({
          interface: "a",
          source: "docs",
          toolset: "none",
          answerable: "YES",
          expected: {
            symbols: [{ value: "RightAPI", satisfied: true }],
            paths: [{ value: "right/path", satisfied: true }],
            excludes: [{ value: "deprecatedAPI", satisfied: true }],
            satisfied: 3,
            total: 3,
          },
        }),
      ]),
    ]);
    const diags = summarizeReadiness(r).diagnostics.filter(
      (d) => d.pattern === "grouped_check_pass",
    );
    expect(diags).toHaveLength(1);
    // The message now includes the excludes tally so the receipt is
    // explicit about what was checked (declared + clean).
    expect(diags[0]?.message).toContain("excludes 1/1");
  });

  test("skipped when any group entry is unsatisfied (partial)", () => {
    const r = report([
      scenario("Partial", [
        cell({
          interface: "a",
          source: "docs",
          toolset: "none",
          answerable: "PARTIAL",
          expected: {
            symbols: [
              { value: "X", satisfied: true },
              { value: "Y", satisfied: false },
            ],
            satisfied: 1,
            total: 2,
          },
        }),
      ]),
    ]);
    const diags = summarizeReadiness(r).diagnostics.filter(
      (d) => d.pattern === "grouped_check_pass",
    );
    expect(diags).toEqual([]);
  });
});

describe("source_comparison", () => {
  test("emits when named source answered and source=none did not on same (interface, toolset)", () => {
    const r = report([
      scenario("Gradient", [
        cell({
          interface: "a",
          source: "none",
          toolset: "none",
          answerable: "NO",
        }),
        cell({
          interface: "a",
          source: "docs",
          toolset: "none",
          answerable: "YES",
        }),
      ]),
    ]);
    const diags = summarizeReadiness(r).diagnostics.filter(
      (d) => d.pattern === "source_comparison",
    );
    expect(diags).toHaveLength(1);
    expect(diags[0]?.message).toContain('Source "docs" answered');
    expect(diags[0]?.message).toContain("model prior");
    expect(diags[0]?.cells).toHaveLength(2);
  });

  test("does not emit when none cell also answered (no comparison signal)", () => {
    const r = report([
      scenario("Gradient", [
        cell({
          interface: "a",
          source: "none",
          toolset: "none",
          answerable: "YES",
        }),
        cell({
          interface: "a",
          source: "docs",
          toolset: "none",
          answerable: "YES",
        }),
      ]),
    ]);
    const diags = summarizeReadiness(r).diagnostics.filter(
      (d) => d.pattern === "source_comparison",
    );
    expect(diags).toEqual([]);
  });

  test("does not pair cells across different interface or toolset axes", () => {
    const r = report([
      scenario("Gradient", [
        cell({
          interface: "a",
          source: "none",
          toolset: "none",
          answerable: "NO",
        }),
        cell({
          interface: "b",
          source: "docs",
          toolset: "web",
          answerable: "YES",
        }),
      ]),
    ]);
    const diags = summarizeReadiness(r).diagnostics.filter(
      (d) => d.pattern === "source_comparison",
    );
    expect(diags).toEqual([]);
  });
});

describe("toolset_comparison", () => {
  test("emits when web answered and none did not on same (interface, source)", () => {
    const r = report([
      scenario("Discovery", [
        cell({
          interface: "a",
          source: "docs",
          toolset: "none",
          answerable: "NO",
        }),
        cell({
          interface: "a",
          source: "docs",
          toolset: "web",
          answerable: "YES",
        }),
      ]),
    ]);
    const diags = summarizeReadiness(r).diagnostics.filter(
      (d) => d.pattern === "toolset_comparison",
    );
    expect(diags).toHaveLength(1);
    expect(diags[0]?.message).toContain('Toolset "web" answered');
    expect(diags[0]?.message).toContain("live discovery");
  });
});

describe("interface_comparison", () => {
  test("emits one diagnosis per (source, toolset) where one interface lags another at YES", () => {
    const r = report([
      scenario("Cross-provider", [
        cell({
          interface: "quick",
          source: "docs",
          toolset: "web",
          answerable: "YES",
        }),
        cell({
          interface: "anthropic_api",
          source: "docs",
          toolset: "web",
          answerable: "YES",
        }),
        cell({
          interface: "openai_api",
          source: "docs",
          toolset: "web",
          answerable: "PARTIAL",
        }),
      ]),
    ]);
    const diags = summarizeReadiness(r).diagnostics.filter(
      (d) => d.pattern === "interface_comparison",
    );
    expect(diags).toHaveLength(1);
    expect(diags[0]?.message).toContain("openai_api:PARTIAL");
    // Lists the YES interfaces.
    expect(diags[0]?.message).toContain("quick");
    expect(diags[0]?.message).toContain("anthropic_api");
  });

  test("does not emit when all interfaces agree at YES (no gap)", () => {
    const r = report([
      scenario("All green", [
        cell({
          interface: "a",
          source: "docs",
          toolset: "none",
          answerable: "YES",
        }),
        cell({
          interface: "b",
          source: "docs",
          toolset: "none",
          answerable: "YES",
        }),
      ]),
    ]);
    const diags = summarizeReadiness(r).diagnostics.filter(
      (d) => d.pattern === "interface_comparison",
    );
    expect(diags).toEqual([]);
  });

  test("does not emit when all interfaces agree (none at YES, all PARTIAL)", () => {
    // All at the same non-YES verdict is not a "gap" - it's a uniform
    // miss. The interface comparison pattern surfaces DIVERGENCE.
    const r = report([
      scenario("Uniform miss", [
        cell({
          interface: "a",
          source: "docs",
          toolset: "none",
          answerable: "PARTIAL",
        }),
        cell({
          interface: "b",
          source: "docs",
          toolset: "none",
          answerable: "PARTIAL",
        }),
      ]),
    ]);
    const diags = summarizeReadiness(r).diagnostics.filter(
      (d) => d.pattern === "interface_comparison",
    );
    expect(diags).toEqual([]);
  });
});

describe("trap_attribution", () => {
  test("emits one diagnostic per scenario with at least one trap firing", () => {
    const r = report([
      scenario("Stale", [
        cell({
          interface: "a",
          source: "x",
          toolset: "none",
          answerable: "NO",
          trapsFired: [
            { id: "ai_powered", reason: "..." },
            { id: "freshness_score", reason: "..." },
          ],
        }),
      ]),
    ]);
    const diags = summarizeReadiness(r).diagnostics.filter(
      (d) => d.pattern === "trap_attribution",
    );
    expect(diags).toHaveLength(1);
    expect(diags[0]?.message).toContain("Traps fired");
    expect(diags[0]?.message).toContain("ai_powered");
    expect(diags[0]?.message).toContain("freshness_score");
  });

  test("emits nothing when no traps fired", () => {
    const r = report([
      scenario("Clean", [
        cell({
          interface: "a",
          source: "x",
          toolset: "none",
          answerable: "YES",
        }),
      ]),
    ]);
    const diags = summarizeReadiness(r).diagnostics.filter(
      (d) => d.pattern === "trap_attribution",
    );
    expect(diags).toEqual([]);
  });
});

describe("structured diagnostic shape", () => {
  test("each diagnostic carries pattern enum + message + scenario + cells", () => {
    const r = report([
      scenario("R", [
        cell({
          interface: "a",
          source: "docs",
          toolset: "none",
          answerable: "YES",
          expected: {
            symbols: [{ value: "X", satisfied: true }],
            satisfied: 1,
            total: 1,
          },
        }),
      ]),
    ]);
    const d = summarizeReadiness(r).diagnostics[0]!;
    expect(typeof d.pattern).toBe("string");
    expect(typeof d.message).toBe("string");
    expect(d.scenario).toBe("R");
    expect(Array.isArray(d.cells)).toBe(true);
    expect(d.cells[0]).toEqual({
      interface: "a",
      source: "docs",
      toolset: "none",
    });
  });
});
