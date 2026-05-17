import { describe, expect, test } from "bun:test";
import type { Trap } from "@pickled-dev/config";
import { scoreTraps } from "../../src/scorers/traps.js";

describe("scoreTraps - literal match", () => {
  const traps: Trap[] = [
    {
      id: "old_schema",
      match: "docs.source:",
      reason: "removed singular schema",
    },
  ];

  test("fires on exact literal substring", () => {
    const r = scoreTraps({
      response: `Example: docs.source: ./README.md`,
      traps,
    });
    expect(r.fired).toHaveLength(1);
    expect(r.fired[0]!.id).toBe("old_schema");
    expect(r.fired[0]!.matched).toBe("docs.source:");
    expect(r.fired[0]!.snippet).toContain("docs.source:");
    expect(r.avoided).toEqual([]);
  });

  test("does not fire on close-but-different text", () => {
    const r = scoreTraps({
      response: `Use docs.sources to declare named sources.`,
      traps,
    });
    expect(r.fired).toHaveLength(0);
    expect(r.avoided).toEqual(["old_schema"]);
  });

  test("literal match is case-sensitive", () => {
    const r = scoreTraps({
      response: `Use DOCS.SOURCE: in caps`,
      traps,
    });
    expect(r.fired).toHaveLength(0);
  });
});

describe("scoreTraps - regex pattern", () => {
  test("fires on regex match", () => {
    const r = scoreTraps({
      response: `Status: gone sour after upgrade`,
      traps: [
        {
          id: "old_brand",
          pattern: "\\bgone\\s+sour\\b",
          reason: "old language",
        },
      ],
    });
    expect(r.fired).toHaveLength(1);
    expect(r.fired[0]!.matched).toBe("gone sour");
  });

  test("regex flags work (case-insensitive)", () => {
    const r = scoreTraps({
      response: `Status: Gone Sour`,
      traps: [
        {
          id: "old_brand",
          pattern: "gone sour",
          flags: "i",
          reason: "old language",
        },
      ],
    });
    expect(r.fired).toHaveLength(1);
  });

  test("regex without flags is case-sensitive", () => {
    const r = scoreTraps({
      response: `Status: Gone Sour`,
      traps: [
        {
          id: "old_brand",
          pattern: "gone sour",
          reason: "old language",
        },
      ],
    });
    expect(r.fired).toHaveLength(0);
  });
});

describe("scoreTraps - multiple traps", () => {
  const traps: Trap[] = [
    { id: "a", match: "alpha", reason: "ra" },
    { id: "b", match: "beta", reason: "rb" },
    { id: "c", match: "gamma", reason: "rc" },
  ];

  test("reports each trap's status", () => {
    const r = scoreTraps({
      response: `mentions alpha and gamma`,
      traps,
    });
    expect(r.fired.map((h) => h.id).sort()).toEqual(["a", "c"]);
    expect(r.avoided).toEqual(["b"]);
  });

  test("no traps configured = no firings", () => {
    const r = scoreTraps({ response: "anything", traps: [] });
    expect(r.fired).toEqual([]);
    expect(r.avoided).toEqual([]);
  });

  test("empty response cannot fire", () => {
    const r = scoreTraps({ response: "", traps });
    expect(r.fired).toEqual([]);
    expect(r.avoided).toEqual(["a", "b", "c"]);
  });
});

describe("scoreTraps - snippet", () => {
  test("snippet includes surrounding context", () => {
    const long = `${"x".repeat(100)}BAD${"y".repeat(100)}`;
    const r = scoreTraps({
      response: long,
      traps: [{ id: "t", match: "BAD", reason: "r" }],
    });
    expect(r.fired[0]!.snippet).toContain("BAD");
    expect(r.fired[0]!.snippet.startsWith("...")).toBe(true);
    expect(r.fired[0]!.snippet.endsWith("...")).toBe(true);
  });

  test("snippet at start of response has no leading ellipsis", () => {
    const r = scoreTraps({
      response: `BAD${"x".repeat(100)}`,
      traps: [{ id: "t", match: "BAD", reason: "r" }],
    });
    expect(r.fired[0]!.snippet.startsWith("...")).toBe(false);
    expect(r.fired[0]!.snippet.endsWith("...")).toBe(true);
  });
});
