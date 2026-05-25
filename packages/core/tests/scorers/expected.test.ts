import { describe, expect, test } from "bun:test";
import { formatExpectedNotes, scoreExpected } from "../../src/scorers/index.js";

describe("scoreExpected", () => {
  test("returns zero totals when no checks are declared", () => {
    const r = scoreExpected({ response: "anything", expected: undefined });
    expect(r.total).toBe(0);
    expect(r.satisfied).toBe(0);
    expect(r.includes).toEqual([]);
    expect(r.excludes).toEqual([]);
    expect(r.symbols).toEqual([]);
    expect(r.paths).toEqual([]);
    expect(r.options).toEqual([]);
    expect(r.constraints).toEqual([]);
  });

  test("includes / excludes behave identically to the pre-grouping version", () => {
    const r = scoreExpected({
      response: "agent says X but not Y",
      expected: { includes: ["X"], excludes: ["Y"] },
    });
    expect(r.includes).toEqual([{ value: "X", satisfied: true }]);
    expect(r.excludes).toEqual([{ value: "Y", satisfied: false }]);
    expect(r.total).toBe(2);
    expect(r.satisfied).toBe(1);
  });

  test("each grouped key is scored independently with substring presence", () => {
    const r = scoreExpected({
      response:
        "calls registerToolbarButton in src/toolbar.ts with icon option after registering the command",
      expected: {
        symbols: ["registerToolbarButton", "MissingSym"],
        paths: ["src/toolbar.ts"],
        options: ["icon", "tooltip"],
        constraints: ["registering the command"],
      },
    });
    expect(r.symbols).toEqual([
      { value: "registerToolbarButton", satisfied: true },
      { value: "MissingSym", satisfied: false },
    ]);
    expect(r.paths).toEqual([{ value: "src/toolbar.ts", satisfied: true }]);
    expect(r.options).toEqual([
      { value: "icon", satisfied: true },
      { value: "tooltip", satisfied: false },
    ]);
    expect(r.constraints).toEqual([
      { value: "registering the command", satisfied: true },
    ]);
    // 2+1+2+1 = 6 declared; satisfied: 1+1+1+1 = 4.
    expect(r.total).toBe(6);
    expect(r.satisfied).toBe(4);
  });

  test("grouped keys are skipped (zero contribution) when not declared", () => {
    const r = scoreExpected({
      response: "x",
      expected: { includes: ["x"] },
    });
    expect(r.symbols).toEqual([]);
    expect(r.paths).toEqual([]);
    expect(r.options).toEqual([]);
    expect(r.constraints).toEqual([]);
    expect(r.total).toBe(1);
    expect(r.satisfied).toBe(1);
  });

  test("includes + grouped keys compose into one satisfied/total tally", () => {
    const r = scoreExpected({
      response: "x and SymbolX",
      expected: { includes: ["x"], symbols: ["SymbolX", "SymbolY"] },
    });
    // includes 1/1 + symbols 1/2 = 2/3.
    expect(r.satisfied).toBe(2);
    expect(r.total).toBe(3);
  });
});

describe("formatExpectedNotes", () => {
  test("returns empty when no checks were declared", () => {
    const notes = formatExpectedNotes(
      scoreExpected({ response: "x", expected: undefined }),
    );
    expect(notes).toEqual([]);
  });

  test("returns satisfied summary when every check passed", () => {
    const notes = formatExpectedNotes(
      scoreExpected({
        response: "x SymbolX",
        expected: { includes: ["x"], symbols: ["SymbolX"] },
      }),
    );
    expect(notes).toEqual(["expected checks satisfied (2/2)"]);
  });

  test("labels each failed group separately (not 'missing includes' for symbols)", () => {
    const notes = formatExpectedNotes(
      scoreExpected({
        response: "no useful content",
        expected: {
          includes: ["foo"],
          symbols: ["bar"],
          paths: ["baz/path"],
          options: ["quux"],
          constraints: ["something"],
          excludes: ["no"],
        },
      }),
    );
    // All groups failed (includes/symbols/paths/options/constraints missing,
    // excludes hit). The note must distinguish them, not roll up under
    // "missing includes".
    expect(notes).toHaveLength(1);
    const line = notes[0]!;
    expect(line).toContain('missing includes: "foo"');
    expect(line).toContain('missing symbols: "bar"');
    expect(line).toContain('missing paths: "baz/path"');
    expect(line).toContain('missing options: "quux"');
    expect(line).toContain('missing constraints: "something"');
    expect(line).toContain('hit excludes: "no"');
  });

  test("only mentions groups that have failures (partial mix)", () => {
    const notes = formatExpectedNotes(
      scoreExpected({
        response: "Editor.update was called",
        expected: {
          symbols: ["Editor.update"],
          options: ["icon", "tooltip"],
        },
      }),
    );
    expect(notes).toHaveLength(1);
    const line = notes[0]!;
    expect(line).not.toContain("missing symbols");
    expect(line).toContain('missing options: "icon", "tooltip"');
  });
});
