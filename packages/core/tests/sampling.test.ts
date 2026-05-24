import { describe, expect, test } from "bun:test";
import { sampleCellsPerScenario } from "../src/sampling.js";

interface Cell {
  scenario: string;
  iface: string;
  source: string;
  toolset: string;
}

function makeCells(scenario: string, count: number): Cell[] {
  return Array.from({ length: count }, (_, i) => ({
    scenario,
    iface: `i${i}`,
    source: `s${i}`,
    toolset: `t${i}`,
  }));
}

describe("sampleCellsPerScenario", () => {
  test("returns all cells when sample size >= per-scenario count", () => {
    const cells = [...makeCells("A", 2), ...makeCells("B", 3)];
    expect(sampleCellsPerScenario(cells, 10, "seed1")).toHaveLength(5);
  });

  test("samples exactly n cells per scenario when source has more", () => {
    const cells = [...makeCells("A", 8), ...makeCells("B", 8)];
    const result = sampleCellsPerScenario(cells, 3, "seed1");
    expect(result.filter((c) => c.scenario === "A")).toHaveLength(3);
    expect(result.filter((c) => c.scenario === "B")).toHaveLength(3);
  });

  test("returns the same sample for the same seed (determinism)", () => {
    const cells = [...makeCells("A", 8), ...makeCells("B", 8)];
    const r1 = sampleCellsPerScenario(cells, 3, "seed-deterministic");
    const r2 = sampleCellsPerScenario(cells, 3, "seed-deterministic");
    expect(r1).toEqual(r2);
  });

  test("returns a different sample for a different seed", () => {
    const cells = makeCells("A", 12);
    const r1 = sampleCellsPerScenario(cells, 4, "seed-one");
    const r2 = sampleCellsPerScenario(cells, 4, "seed-two");
    // 4-of-12 collisions across two different seeds are possible but
    // vanishingly rare in practice; this asserts the sampler is not
    // degenerately ignoring the seed input.
    expect(r1).not.toEqual(r2);
  });

  test("preserves within-scenario input order in the output", () => {
    const cells = makeCells("A", 10);
    const result = sampleCellsPerScenario(cells, 5, "seed1");
    // For each adjacent pair in the result, the second's index in the
    // input must be > the first's. The sampler picks N positions then
    // emits them in original order so the receipt grid stays readable.
    const indices = result.map((c) =>
      cells.findIndex(
        (x) =>
          x.iface === c.iface &&
          x.source === c.source &&
          x.toolset === c.toolset,
      ),
    );
    const sorted = [...indices].sort((a, b) => a - b);
    expect(indices).toEqual(sorted);
  });

  test("groups scenarios independently (sample of 2 each, not 2 total)", () => {
    const cells = [
      ...makeCells("A", 5),
      ...makeCells("B", 5),
      ...makeCells("C", 5),
    ];
    const result = sampleCellsPerScenario(cells, 2, "seed1");
    expect(result).toHaveLength(6);
    expect(result.filter((c) => c.scenario === "A")).toHaveLength(2);
    expect(result.filter((c) => c.scenario === "B")).toHaveLength(2);
    expect(result.filter((c) => c.scenario === "C")).toHaveLength(2);
  });

  test("returns empty array when n is 0", () => {
    expect(sampleCellsPerScenario(makeCells("A", 5), 0, "seed1")).toEqual([]);
  });

  test("returns empty array when n is negative", () => {
    expect(sampleCellsPerScenario(makeCells("A", 5), -1, "seed1")).toEqual([]);
  });

  test("preserves scenario insertion order across the output", () => {
    const cells = [
      ...makeCells("B", 3),
      ...makeCells("A", 3),
      ...makeCells("C", 3),
    ];
    const result = sampleCellsPerScenario(cells, 1, "seed1");
    expect(result.map((c) => c.scenario)).toEqual(["B", "A", "C"]);
  });
});
