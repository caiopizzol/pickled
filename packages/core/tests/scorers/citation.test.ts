import { describe, expect, test } from "bun:test";
import { parseCitations, scoreCitations } from "../../src/scorers/citation.js";

describe("parseCitations", () => {
  test("returns empty when no Sources section", () => {
    expect(parseCitations("just an answer")).toEqual([]);
  });

  test("returns empty when Sources section has no bracketed items", () => {
    const r = `Answer.\n\n## Sources\n- README.md\n- something else`;
    expect(parseCitations(r)).toEqual([]);
  });

  test("extracts bracketed IDs", () => {
    const r = `Answer.\n\n## Sources\n- [readme] base usage\n- [llms] discovered via llms.txt`;
    expect(parseCitations(r)).toEqual([
      { id: "readme", note: "base usage" },
      { id: "llms", note: "discovered via llms.txt" },
    ]);
  });

  test("handles IDs without notes", () => {
    const r = `## Sources\n- [readme]`;
    expect(parseCitations(r)).toEqual([{ id: "readme", note: undefined }]);
  });

  test("is case-insensitive on heading", () => {
    const r = `## sources\n- [readme] note`;
    expect(parseCitations(r)).toEqual([{ id: "readme", note: "note" }]);
  });

  test("stops at next ## heading", () => {
    const r = `## Sources\n- [a] one\n\n## Notes\n- [b] should not be cited`;
    expect(parseCitations(r)).toEqual([{ id: "a", note: "one" }]);
  });

  test("trims whitespace in IDs", () => {
    const r = `## Sources\n-   [  readme  ]   a note`;
    expect(parseCitations(r)).toEqual([{ id: "readme", note: "a note" }]);
  });
});

describe("scoreCitations", () => {
  const registered = ["readme", "llms", "migration"];

  test("NO when no citations at all", () => {
    const s = scoreCitations({
      response: "no sources section",
      requiredSources: ["readme"],
      registeredIds: registered,
    });
    expect(s.answerable).toBe("NO");
    expect(s.confidence).toBe(0);
  });

  test("NO when every citation is unknown", () => {
    const s = scoreCitations({
      response: `## Sources\n- [fakeone] x\n- [faketwo] y`,
      requiredSources: ["readme"],
      registeredIds: registered,
    });
    expect(s.answerable).toBe("NO");
    expect(s.citations.unknown).toEqual(["fakeone", "faketwo"]);
  });

  test("YES when all required cited and no unknowns", () => {
    const s = scoreCitations({
      response: `## Sources\n- [readme] base\n- [migration] upgrade path`,
      requiredSources: ["readme", "migration"],
      registeredIds: registered,
    });
    expect(s.answerable).toBe("YES");
    expect(s.confidence).toBe(100);
    expect(s.citations.missing).toEqual([]);
  });

  test("YES when requiredSources is empty and at least one valid citation", () => {
    const s = scoreCitations({
      response: `## Sources\n- [readme] note`,
      requiredSources: [],
      registeredIds: registered,
    });
    expect(s.answerable).toBe("YES");
  });

  test("PARTIAL when a required source is missing", () => {
    const s = scoreCitations({
      response: `## Sources\n- [readme] note`,
      requiredSources: ["readme", "migration"],
      registeredIds: registered,
    });
    expect(s.answerable).toBe("PARTIAL");
    expect(s.citations.missing).toEqual(["migration"]);
    expect(s.confidence).toBeGreaterThan(0);
    expect(s.confidence).toBeLessThan(100);
  });

  test("PARTIAL with unknown citation penalty", () => {
    const s = scoreCitations({
      response: `## Sources\n- [readme] real\n- [fake] not real`,
      requiredSources: ["readme"],
      registeredIds: registered,
    });
    expect(s.answerable).toBe("PARTIAL");
    expect(s.citations.unknown).toEqual(["fake"]);
    expect(s.confidence).toBeLessThan(100);
  });
});
