import type { CheckConfig, Scenario } from "@pickled-dev/config";
import { type PresentGroup, scoreExpected } from "./scorers/expected.js";
import { scoreTraps } from "./scorers/traps.js";

/**
 * Offline example testing. Scores `scenario.examples.pass` / `.fail` strings
 * against the scenario's deterministic text contract (`expected` + `traps`)
 * using the SAME scorers a real run uses. No model calls, no providers, no
 * citation/provenance (an example has no source-injection context).
 *
 * A response satisfies the contract iff every declared `expected` check is
 * satisfied AND no trap fires. A `pass` example should satisfy it; a `fail`
 * example should not. A mismatch means a brittle/over-specific check or a
 * false-firing trap (caught before any paid run).
 */

const PRESENT_GROUPS: readonly PresentGroup[] = [
  "includes",
  "symbols",
  "paths",
  "options",
  "constraints",
];

export interface ExampleResult {
  kind: "pass" | "fail";
  response: string;
  /** Whether the deterministic contract treats this response as a pass. */
  contractPass: boolean;
  /** True when contractPass matches the declared kind. */
  ok: boolean;
  /** Why the contract did (not) pass: unmet checks and/or fired traps. */
  reasons: string[];
}

export interface ScenarioExampleReport {
  scenario: string;
  results: ExampleResult[];
}

export interface ExampleTestReport {
  scenarios: ScenarioExampleReport[];
  total: number;
  mismatches: number;
}

function evaluate(
  scenario: Scenario,
  response: string,
): { contractPass: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const expected = scoreExpected({ response, expected: scenario.expected });
  for (const group of PRESENT_GROUPS) {
    for (const c of expected[group]) {
      if (!c.satisfied)
        reasons.push(`missing ${group}: ${JSON.stringify(c.value)}`);
    }
  }
  for (const c of expected.excludes) {
    if (!c.satisfied)
      reasons.push(`present (excluded): ${JSON.stringify(c.value)}`);
  }
  const traps = scoreTraps({ response, traps: scenario.traps ?? [] });
  for (const t of traps.fired) reasons.push(`trap fired: ${t.id}`);

  const contractPass =
    expected.satisfied === expected.total && traps.fired.length === 0;
  return { contractPass, reasons };
}

export function runExampleTests(config: CheckConfig): ExampleTestReport {
  const scenarios: ScenarioExampleReport[] = [];
  let total = 0;
  let mismatches = 0;

  for (const scenario of config.scenarios) {
    const examples = scenario.examples;
    if (!examples || (!examples.pass?.length && !examples.fail?.length)) {
      continue;
    }
    const results: ExampleResult[] = [];
    for (const response of examples.pass ?? []) {
      const { contractPass, reasons } = evaluate(scenario, response);
      const ok = contractPass;
      results.push({ kind: "pass", response, contractPass, ok, reasons });
      total++;
      if (!ok) mismatches++;
    }
    for (const response of examples.fail ?? []) {
      const { contractPass, reasons } = evaluate(scenario, response);
      const ok = !contractPass;
      results.push({ kind: "fail", response, contractPass, ok, reasons });
      total++;
      if (!ok) mismatches++;
    }
    scenarios.push({ scenario: scenario.name, results });
  }
  return { scenarios, total, mismatches };
}
