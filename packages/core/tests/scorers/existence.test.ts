import { describe, expect, test } from "bun:test";
import type { ResolvedDocSource } from "@pickled-dev/config";
import {
  formatExistenceNotes,
  scoreExpected,
  verifyExpectedExistence,
} from "../../src/scorers/index.js";

function codebaseSource(args: {
  id?: string;
  content?: string;
  matchedFiles?: string[];
}): ResolvedDocSource {
  return {
    id: args.id ?? "core",
    source: "packages/core/src/**/*.ts",
    type: "codebase",
    name: "core",
    auditTraps: true,
    content: args.content ?? "",
    matchedFiles: args.matchedFiles ?? [],
  };
}

function urlSource(): ResolvedDocSource {
  return {
    id: "docs",
    source: "https://example.com/llms.txt",
    type: "url",
    name: "docs",
    auditTraps: true,
    content: "doc text",
  };
}

describe("verifyExpectedExistence", () => {
  test("marks every declared symbol/path as null when no codebase source is registered", () => {
    const detail = scoreExpected({
      response: "x",
      expected: { symbols: ["Foo", "Bar"], paths: ["src/a.ts"] },
    });
    verifyExpectedExistence(detail, [urlSource()]);
    expect(detail.symbols.map((c) => c.existsInCodebase)).toEqual([null, null]);
    expect(detail.paths.map((c) => c.existsInCodebase)).toEqual([null]);
  });

  test("symbols: substring presence in concatenated codebase content", () => {
    const detail = scoreExpected({
      response: "x",
      expected: { symbols: ["registerToolbarButton", "Hallucinated"] },
    });
    verifyExpectedExistence(detail, [
      codebaseSource({
        content:
          "// === src/toolbar.ts ===\nexport function registerToolbarButton() {}\n",
      }),
    ]);
    expect(detail.symbols[0]?.existsInCodebase).toBe(true);
    expect(detail.symbols[1]?.existsInCodebase).toBe(false);
  });

  test("paths: exact-equal match against matchedFiles", () => {
    const detail = scoreExpected({
      response: "x",
      expected: { paths: ["packages/core/src/check.ts", "src/typo.ts"] },
    });
    verifyExpectedExistence(detail, [
      codebaseSource({
        matchedFiles: [
          "packages/core/src/check.ts",
          "packages/core/src/types.ts",
        ],
      }),
    ]);
    expect(detail.paths[0]?.existsInCodebase).toBe(true);
    expect(detail.paths[1]?.existsInCodebase).toBe(false);
  });

  test("paths: suffix match works so vendors can omit the monorepo prefix", () => {
    const detail = scoreExpected({
      response: "x",
      expected: { paths: ["src/editor/toolbar.ts"] },
    });
    verifyExpectedExistence(detail, [
      codebaseSource({
        matchedFiles: ["packages/editor/src/editor/toolbar.ts"],
      }),
    ]);
    expect(detail.paths[0]?.existsInCodebase).toBe(true);
  });

  test("paths: substring (not suffix) does NOT match - prevents false positives", () => {
    const detail = scoreExpected({
      response: "x",
      expected: { paths: ["editor/toolbar"] },
    });
    verifyExpectedExistence(detail, [
      codebaseSource({
        matchedFiles: ["packages/editor/src/editor/toolbar.ts"],
      }),
    ]);
    // "editor/toolbar" is a substring of the path but not a path-suffix
    // (the file is "editor/toolbar.ts"). Suffix match keeps this honest.
    expect(detail.paths[0]?.existsInCodebase).toBe(false);
  });

  test("multiple codebase sources are concatenated for symbol search and unioned for paths", () => {
    const detail = scoreExpected({
      response: "x",
      expected: {
        symbols: ["fromA", "fromB"],
        paths: ["a.ts", "b.ts"],
      },
    });
    verifyExpectedExistence(detail, [
      codebaseSource({ id: "a", content: "fromA", matchedFiles: ["a.ts"] }),
      codebaseSource({ id: "b", content: "fromB", matchedFiles: ["b.ts"] }),
    ]);
    expect(detail.symbols.map((c) => c.existsInCodebase)).toEqual([true, true]);
    expect(detail.paths.map((c) => c.existsInCodebase)).toEqual([true, true]);
  });

  test("does not touch existsInCodebase on includes/excludes/options/constraints", () => {
    const detail = scoreExpected({
      response: "x",
      expected: {
        includes: ["a"],
        excludes: ["b"],
        options: ["c"],
        constraints: ["d"],
      },
    });
    verifyExpectedExistence(detail, [codebaseSource({})]);
    expect(detail.includes[0]?.existsInCodebase).toBeUndefined();
    expect(detail.excludes[0]?.existsInCodebase).toBeUndefined();
    expect(detail.options[0]?.existsInCodebase).toBeUndefined();
    expect(detail.constraints[0]?.existsInCodebase).toBeUndefined();
  });
});

describe("formatExistenceNotes", () => {
  test("returns empty when no checks were declared", () => {
    const detail = scoreExpected({ response: "x", expected: undefined });
    expect(formatExistenceNotes(detail)).toEqual([]);
  });

  test("returns empty when codebase was not registered (every existsInCodebase is null)", () => {
    const detail = scoreExpected({
      response: "x",
      expected: { symbols: ["Foo"] },
    });
    verifyExpectedExistence(detail, [urlSource()]);
    expect(formatExistenceNotes(detail)).toEqual([]);
  });

  test("returns empty when every declared value exists", () => {
    const detail = scoreExpected({
      response: "x",
      expected: { symbols: ["Foo"], paths: ["a.ts"] },
    });
    verifyExpectedExistence(detail, [
      codebaseSource({ content: "Foo", matchedFiles: ["a.ts"] }),
    ]);
    expect(formatExistenceNotes(detail)).toEqual([]);
  });

  test("emits one line per group with at least one missing value", () => {
    const detail = scoreExpected({
      response: "x",
      expected: {
        symbols: ["Foo", "Missing"],
        paths: ["a.ts", "typo.ts"],
      },
    });
    verifyExpectedExistence(detail, [
      codebaseSource({ content: "Foo", matchedFiles: ["a.ts"] }),
    ]);
    const notes = formatExistenceNotes(detail);
    expect(notes).toHaveLength(2);
    expect(notes[0]).toBe('declared symbols missing from codebase: "Missing"');
    expect(notes[1]).toBe('declared paths missing from codebase: "typo.ts"');
  });
});
