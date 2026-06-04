import { describe, expect, test } from "bun:test";
import { sampleCellsPerTask } from "../src/sampling.js";

interface Cell {
  task: string;
  context: string;
}

function cells(): Cell[] {
  return [
    { task: "q1", context: "a" },
    { task: "q1", context: "b" },
    { task: "q1", context: "c" },
    { task: "q2", context: "a" },
    { task: "q2", context: "b" },
  ];
}

describe("sampleCellsPerTask", () => {
  test("samples N per task, not N total", () => {
    const out = sampleCellsPerTask(cells(), 1, "seed");
    expect(out.filter((c) => c.task === "q1")).toHaveLength(1);
    expect(out.filter((c) => c.task === "q2")).toHaveLength(1);
  });

  test("a task with <= N cells keeps all of them", () => {
    const out = sampleCellsPerTask(cells(), 2, "seed");
    // q2 has exactly 2 cells -> both kept; q1 has 3 -> 2 kept.
    expect(out.filter((c) => c.task === "q2")).toHaveLength(2);
    expect(out.filter((c) => c.task === "q1")).toHaveLength(2);
  });

  test("same seed -> same selection (deterministic)", () => {
    const a = sampleCellsPerTask(cells(), 1, "fixed");
    const b = sampleCellsPerTask(cells(), 1, "fixed");
    expect(a).toEqual(b);
  });

  test("output preserves input order within a task", () => {
    const out = sampleCellsPerTask(cells(), 2, "seed").filter(
      (c) => c.task === "q1",
    );
    const order = out.map((c) => c.context);
    expect(order).toEqual([...order].sort());
  });

  test("n <= 0 selects nothing", () => {
    expect(sampleCellsPerTask(cells(), 0, "seed")).toEqual([]);
  });
});
