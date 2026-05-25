import type { CellResult, CheckReport, ScenarioResult } from "./types.js";

/**
 * Implementation-readiness reporter (#22 / step 4 of #19). Derives
 * human-readable diagnoses from existing cell receipts. Reads only;
 * does not change scoring. Every diagnosis is a pattern over the
 * fields already in CheckReport (`expected.symbols/paths/options/
 * constraints`, `answerable`, `cell.{interface,source,toolset}`,
 * `traps.fired`); no model is asked to interpret receipts.
 *
 * v1 ships five "Group A" patterns - the ones the current pickled.yml
 * dogfood suite produces today. "Group B" patterns (codebase-vs-docs
 * disagreement, declared-path-missing-from-codebase) need scenarios
 * that don't exist in the current suite; the substrate ships in #20/
 * #21 but no dogfood receipt covers them yet, so they wait for either
 * a contributor-mode scenario or a vendor with their own setup.
 */

/** Discriminator for diagnostic patterns. Add to the union when adding
 *  a matcher; the union is exhaustively switched in the renderer. */
export type ReadinessPattern =
  | "grouped_check_pass"
  | "source_comparison"
  | "toolset_comparison"
  | "interface_comparison"
  | "trap_attribution";

/** Coordinates of a matrix cell, for attribution in JSON consumers. */
export interface CellCoord {
  interface: string;
  source: string | null;
  toolset: string;
}

export interface ReadinessDiagnostic {
  pattern: ReadinessPattern;
  /** Human-readable line for terminal display. Single sentence, no
   *  trailing period, no chalk codes (the renderer adds color). */
  message: string;
  /** Scenario name the diagnostic applies to. */
  scenario: string;
  /** Cell(s) the diagnostic attributes to. Single cell for per-cell
   *  patterns (grouped_check_pass); pair for axis-comparison patterns
   *  (source/toolset/interface); empty for scenario-wide patterns. */
  cells: CellCoord[];
}

export interface ReadinessSummary {
  diagnostics: ReadinessDiagnostic[];
}

/**
 * Build a ReadinessSummary from a completed CheckReport. Pure function;
 * no I/O. Called from runCheck after scenarios resolve so the summary
 * is stamped on the report alongside `plan` and `summary`.
 */
export function summarizeReadiness(report: CheckReport): ReadinessSummary {
  const diagnostics: ReadinessDiagnostic[] = [];
  for (const scenario of report.scenarios) {
    diagnostics.push(...findGroupedCheckPass(scenario));
    diagnostics.push(...findSourceComparison(scenario));
    diagnostics.push(...findToolsetComparison(scenario));
    diagnostics.push(...findInterfaceComparison(scenario));
    diagnostics.push(...findTrapAttribution(scenario));
  }
  return { diagnostics };
}

/** Coordinates pretty-printed for the terminal block. */
function fmtCoord(c: CellCoord): string {
  return `${c.interface} · ${c.source ?? "-"} · ${c.toolset}`;
}

function cellCoord(cell: CellResult): CellCoord {
  return {
    interface: cell.cell.interface,
    source: cell.cell.source,
    toolset: cell.cell.toolset,
  };
}

// ---------------------------------------------------------------------
// Pattern: grouped_check_pass
//
// Any cell (matrix) or scenario (single-mode) that declared an
// implementation-readiness grouped key (symbols / paths / options /
// constraints) AND satisfied every entry across every group is a
// "full readiness signal." Surface it so the reporter calls out the
// places where readiness actually held end-to-end.
//
// Skipped when only the legacy includes/excludes shape is declared -
// that's not a readiness signal; it's the older substring contract.
// Single-mode scenarios carry the grouped fields on
// ScenarioResult.expected after #21, so this pattern walks both
// shapes uniformly.
// ---------------------------------------------------------------------
function findGroupedCheckPass(scenario: ScenarioResult): ReadinessDiagnostic[] {
  const out: ReadinessDiagnostic[] = [];
  if (scenario.cells) {
    for (const cell of scenario.cells) {
      const diag = buildGroupedCheckPass(
        cell.expected,
        scenario.scenario.name,
        cellCoord(cell),
      );
      if (diag) out.push(diag);
    }
  } else {
    // Single-mode: the grouped fields live on ScenarioResult.expected,
    // not under any cell. There is no matrix coordinate to attribute
    // to; the diagnostic carries the scenario name with empty cells.
    const diag = buildGroupedCheckPass(
      scenario.expected,
      scenario.scenario.name,
      null,
    );
    if (diag) out.push(diag);
  }
  return out;
}

/**
 * Shared helper used by both the matrix-cell loop and the single-mode
 * path. Returns the diagnostic when every declared grouped entry
 * satisfied, null when the input is missing, empty of grouped keys, or
 * has any unsatisfied entry. The `coord` is included in the diagnostic's
 * cells list when provided (matrix); single-mode passes null and the
 * scenario name carries the attribution.
 */
function buildGroupedCheckPass(
  exp:
    | {
        symbols: Array<{ value: string; satisfied: boolean }>;
        paths: Array<{ value: string; satisfied: boolean }>;
        options: Array<{ value: string; satisfied: boolean }>;
        constraints: Array<{ value: string; satisfied: boolean }>;
      }
    | undefined,
  scenarioName: string,
  coord: CellCoord | null,
): ReadinessDiagnostic | null {
  if (!exp) return null;
  const groups = [exp.symbols, exp.paths, exp.options, exp.constraints];
  const declared = groups.reduce((n, g) => n + g.length, 0);
  if (declared === 0) return null;
  const allSatisfied = groups.every((g) => g.every((c) => c.satisfied));
  if (!allSatisfied) return null;
  const parts: string[] = [];
  if (exp.symbols.length > 0)
    parts.push(`symbols ${exp.symbols.length}/${exp.symbols.length}`);
  if (exp.paths.length > 0)
    parts.push(`paths ${exp.paths.length}/${exp.paths.length}`);
  if (exp.options.length > 0)
    parts.push(`options ${exp.options.length}/${exp.options.length}`);
  if (exp.constraints.length > 0)
    parts.push(
      `constraints ${exp.constraints.length}/${exp.constraints.length}`,
    );
  const location = coord
    ? `[${fmtCoord(coord)}]`
    : `scenario "${scenarioName}"`;
  return {
    pattern: "grouped_check_pass",
    message: `Full readiness signal on ${location}: ${parts.join(", ")}`,
    scenario: scenarioName,
    cells: coord ? [coord] : [],
  };
}

// ---------------------------------------------------------------------
// Pattern: source_comparison
//
// For matrix scenarios that include both `source: none` (no context)
// and a named source, compare cells on the same (interface, toolset)
// axis. If the named-source cell answered (YES/PARTIAL) but the none
// cell did not (NO), report the docs are doing comprehension work
// the model prior would have missed.
// ---------------------------------------------------------------------
function findSourceComparison(scenario: ScenarioResult): ReadinessDiagnostic[] {
  const cells = scenario.cells ?? [];
  if (cells.length === 0) return [];
  const out: ReadinessDiagnostic[] = [];
  for (const noneCell of cells.filter((c) => c.cell.source === "none")) {
    for (const otherCell of cells) {
      if (otherCell === noneCell) continue;
      if (otherCell.cell.source === "none") continue;
      if (otherCell.cell.source === null) continue;
      if (otherCell.cell.interface !== noneCell.cell.interface) continue;
      if (otherCell.cell.toolset !== noneCell.cell.toolset) continue;
      if (
        (otherCell.answerable === "YES" ||
          otherCell.answerable === "PARTIAL") &&
        noneCell.answerable === "NO"
      ) {
        out.push({
          pattern: "source_comparison",
          message: `Source "${otherCell.cell.source}" answered (${otherCell.answerable}) while model prior (source=none) did not on [${noneCell.cell.interface} · ${noneCell.cell.toolset}] - source is doing the comprehension work`,
          scenario: scenario.scenario.name,
          cells: [cellCoord(otherCell), cellCoord(noneCell)],
        });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------
// Pattern: toolset_comparison
//
// For matrix scenarios that include both `toolset: none` and a tool-
// enabled toolset (e.g. web), compare cells on the same (interface,
// source) axis. If the tool-enabled cell answered but the none cell
// did not, report that the agent needed live discovery to reach the
// answer.
// ---------------------------------------------------------------------
function findToolsetComparison(
  scenario: ScenarioResult,
): ReadinessDiagnostic[] {
  const cells = scenario.cells ?? [];
  if (cells.length === 0) return [];
  const out: ReadinessDiagnostic[] = [];
  for (const noneCell of cells.filter((c) => c.cell.toolset === "none")) {
    for (const otherCell of cells) {
      if (otherCell === noneCell) continue;
      if (otherCell.cell.toolset === "none") continue;
      if (otherCell.cell.interface !== noneCell.cell.interface) continue;
      if (otherCell.cell.source !== noneCell.cell.source) continue;
      if (
        (otherCell.answerable === "YES" ||
          otherCell.answerable === "PARTIAL") &&
        noneCell.answerable === "NO"
      ) {
        out.push({
          pattern: "toolset_comparison",
          message: `Toolset "${otherCell.cell.toolset}" answered (${otherCell.answerable}) while controlled (toolset=none) did not on [${noneCell.cell.interface} · ${noneCell.cell.source ?? "-"}] - agent needed live discovery to reach this answer`,
          scenario: scenario.scenario.name,
          cells: [cellCoord(otherCell), cellCoord(noneCell)],
        });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------
// Pattern: interface_comparison
//
// For matrix scenarios that include multiple interfaces, find any
// (source, toolset) tuple where at least one interface scored YES and
// another scored worse than YES. Report it as a provider-specific gap.
// ---------------------------------------------------------------------
function findInterfaceComparison(
  scenario: ScenarioResult,
): ReadinessDiagnostic[] {
  const cells = scenario.cells ?? [];
  if (cells.length === 0) return [];
  const out: ReadinessDiagnostic[] = [];
  // Group cells by (source, toolset). Reading the array after a
  // ?? [] fallback avoids the non-null assertion warning the earlier
  // `groups.get(key)!` produced.
  const groups = new Map<string, CellResult[]>();
  for (const cell of cells) {
    const key = `${cell.cell.source ?? ""}\u0001${cell.cell.toolset}`;
    const existing = groups.get(key) ?? [];
    existing.push(cell);
    groups.set(key, existing);
  }
  for (const [_, group] of groups) {
    if (group.length < 2) continue;
    const interfaces = new Set(group.map((c) => c.cell.interface));
    if (interfaces.size < 2) continue;
    const yesCells = group.filter((c) => c.answerable === "YES");
    const worseCells = group.filter((c) => c.answerable !== "YES");
    if (yesCells.length === 0 || worseCells.length === 0) continue;
    // Report once per (source, toolset) group with the names of the
    // YES interfaces and the worse interfaces. Keeps the output dense.
    const yesNames = yesCells.map((c) => c.cell.interface).join(", ");
    const worseNames = worseCells
      .map((c) => `${c.cell.interface}:${c.answerable}`)
      .join(", ");
    const sample = group[0];
    if (!sample) continue;
    out.push({
      pattern: "interface_comparison",
      message: `Provider gap on [${sample.cell.source ?? "-"} · ${sample.cell.toolset}]: [${yesNames}] at YES, [${worseNames}] - interface-specific comprehension gap`,
      scenario: scenario.scenario.name,
      cells: group.map(cellCoord),
    });
  }
  return out;
}

// ---------------------------------------------------------------------
// Pattern: trap_attribution
//
// For any scenario whose cells (or top-level single-mode result)
// declared traps and had at least one fire, report the count and the
// trap ids. Trap firing is already surfaced in the cell reason; the
// readiness summary just hoists it to a scenario-level diagnostic so
// the reporter can show "stale-content pipeline is working" at a
// glance.
// ---------------------------------------------------------------------
function findTrapAttribution(scenario: ScenarioResult): ReadinessDiagnostic[] {
  const fired = new Set<string>();
  let count = 0;
  const collectFrom = (
    traps: { fired: Array<{ id: string }> } | null,
  ): void => {
    if (!traps) return;
    for (const t of traps.fired) {
      fired.add(t.id);
      count++;
    }
  };
  if (scenario.cells) {
    for (const cell of scenario.cells) collectFrom(cell.traps);
  } else {
    collectFrom(scenario.traps);
  }
  if (count === 0) return [];
  return [
    {
      pattern: "trap_attribution",
      message: `Traps fired on "${scenario.scenario.name}": ${count} firing(s) across [${[...fired].join(", ")}]`,
      scenario: scenario.scenario.name,
      cells: [],
    },
  ];
}
