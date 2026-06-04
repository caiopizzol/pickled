import { describe, expect, test } from "bun:test";
import type { Config } from "@pickled-dev/config";
import { runExampleTests } from "../src/examples.js";

/** A resolved v2 Config with one question. Tests mutate the question. */
function config(question: Partial<Config["questions"][number]>): Config {
  return {
    product: { name: "p", description: "d" },
    sources: {},
    agents: { a: { category: "cli", provider: "claude-code", model: "m" } },
    contexts: { mem: { mode: "memory" } },
    facts: {
      install: { statement: "install", match: { allOf: ["bunx pickled"] } },
    },
    misstatements: {
      npm: { statement: "npm", match: { anyOf: ["npm install pickled"] } },
    },
    questions: [
      {
        id: "q",
        question: "how to install?",
        agents: ["a"],
        contexts: ["mem"],
        expects: ["install"],
        rejects: [],
        ...question,
      },
    ],
    builds: [],
    thresholds: {},
  };
}

describe("runExampleTests", () => {
  test("no examples declared -> total 0", () => {
    const r = runExampleTests(config({}));
    expect(r.total).toBe(0);
  });

  test("a pass example must score YES", () => {
    const r = runExampleTests(
      config({
        examples: { pass: ["Install with bunx pickled."], fail: [] },
      }),
    );
    expect(r.mismatches).toBe(0);
    expect(r.questions[0]?.results[0]?.verdict).toBe("YES");
    expect(r.questions[0]?.results[0]?.ok).toBe(true);
  });

  test("a pass example that misses a fact is a mismatch", () => {
    const r = runExampleTests(
      config({ examples: { pass: ["Install it somehow."], fail: [] } }),
    );
    expect(r.mismatches).toBe(1);
    expect(r.questions[0]?.results[0]?.ok).toBe(false);
  });

  test("for an expects-only question, a fail example just needs to be non-YES", () => {
    const r = runExampleTests(
      config({ examples: { pass: [], fail: ["no command here"] } }),
    );
    expect(r.mismatches).toBe(0);
    expect(r.questions[0]?.results[0]?.ok).toBe(true);
  });

  test("for a rejects question, a fail example MUST trip the misstatement", () => {
    // Missing the fact but NOT tripping the misstatement: non-YES, but does not
    // calibrate the veto, so it must be flagged as a mismatch.
    const r = runExampleTests(
      config({
        rejects: ["npm"],
        examples: { pass: ["bunx pickled"], fail: ["something unrelated"] },
      }),
    );
    const failResult = r.questions[0]?.results.find((x) => x.kind === "fail");
    expect(failResult?.ok).toBe(false);
    expect(r.mismatches).toBe(1);
  });

  test("a rejects fail example that trips the misstatement calibrates", () => {
    const r = runExampleTests(
      config({
        rejects: ["npm"],
        examples: {
          pass: ["bunx pickled"],
          fail: ["npm install pickled"],
        },
      }),
    );
    expect(r.mismatches).toBe(0);
  });
});
