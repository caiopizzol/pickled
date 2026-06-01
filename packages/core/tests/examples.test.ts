import { expect, test } from "bun:test";
import type { CheckConfig } from "@pickled-dev/config";
import { runExampleTests } from "../src/examples.js";

// runExampleTests only reads config.scenarios, so a minimal cast is enough.
function withScenario(scenario: object): CheckConfig {
  return { scenarios: [scenario] } as unknown as CheckConfig;
}

const base = {
  name: "S",
  prompt: "p",
  matrix: { interfaces: ["q"], sources: ["readme"], toolsets: ["none"] },
  expected: {
    symbols: ["SuperDocUIProvider"],
    paths: ["superdoc/ui/react"],
  },
};

test("a clean pass example passes", () => {
  const report = runExampleTests(
    withScenario({
      ...base,
      examples: { pass: ["Use SuperDocUIProvider from superdoc/ui/react."] },
    }),
  );
  expect(report.mismatches).toBe(0);
});

test("flags a pass example that misses a required check", () => {
  const report = runExampleTests(
    withScenario({
      ...base,
      examples: { pass: ["SuperDocUIProvider is the entry point."] },
    }),
  );
  expect(report.mismatches).toBe(1);
  const result = report.scenarios[0].results[0];
  expect(result.ok).toBe(false);
  expect(result.reasons.join(" ")).toContain("superdoc/ui/react");
});

test("anyOf: a pass example missing every value fails", () => {
  const report = runExampleTests(
    withScenario({
      name: "S",
      prompt: "p",
      expected: {
        anyOf: [{ label: "names a provider", values: ["openai", "anthropic"] }],
      },
      examples: { pass: ["The agent answered from memory."] },
    }),
  );
  expect(report.mismatches).toBe(1);
  expect(report.scenarios[0].results[0].reasons.join(" ")).toContain(
    "none of names a provider",
  );
});

test("anyOf: a pass example with one value satisfies the group", () => {
  const report = runExampleTests(
    withScenario({
      name: "S",
      prompt: "p",
      expected: {
        anyOf: [{ label: "names a provider", values: ["openai", "anthropic"] }],
      },
      examples: { pass: ["It used the openai responses API."] },
    }),
  );
  expect(report.mismatches).toBe(0);
});

test("a fail example that misses a required check is ok", () => {
  const report = runExampleTests(
    withScenario({
      ...base,
      examples: { fail: ["Use editor.doc for your React toolbar."] },
    }),
  );
  expect(report.mismatches).toBe(0);
  expect(report.scenarios[0].results[0].ok).toBe(true);
});

test("flags a fail example that satisfies everything (check too weak)", () => {
  const report = runExampleTests(
    withScenario({
      ...base,
      examples: { fail: ["SuperDocUIProvider lives in superdoc/ui/react."] },
    }),
  );
  expect(report.mismatches).toBe(1);
});

test("scenarios without examples are skipped", () => {
  const report = runExampleTests(withScenario({ ...base }));
  expect(report.total).toBe(0);
});
