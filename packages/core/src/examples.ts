import type { Config, Question } from "@pickled-dev/config";
import { scoreQuestionTrial } from "./scorers/index.js";

/**
 * Offline example testing for `pickled test`. Scores each `examples.pass` /
 * `.fail` string against the question's fact/misstatement contract using the
 * SAME matcher a real run uses. No model calls, no provenance (an example has
 * no tool context).
 *
 * A `pass` example must score YES. A `fail` example must be a genuine failure:
 * for a question with `rejects` it must actually TRIP a misstatement (not merely
 * miss a fact), which is what proves the hard veto fires; for a question with
 * only `expects` it must simply score non-YES. This is what makes the rejects
 * hard veto safe: a fail example that never hits the misstatement fails
 * calibration here, before any paid run.
 */
export interface ExampleResult {
  kind: "pass" | "fail";
  response: string;
  /** Contract verdict the offline scorer assigned (provenance not applicable). */
  verdict: "YES" | "PARTIAL" | "NO";
  /** True when the example calibrates as intended. */
  ok: boolean;
  reasons: string[];
}

export interface QuestionExampleReport {
  question: string;
  results: ExampleResult[];
}

export interface ExampleTestReport {
  questions: QuestionExampleReport[];
  total: number;
  mismatches: number;
}

interface Evaluated {
  verdict: "YES" | "PARTIAL" | "NO";
  misstatementsHit: string[];
  factsMissed: string[];
}

function evaluate(
  question: Question,
  config: Config,
  response: string,
): Evaluated {
  const trial = scoreQuestionTrial({
    response,
    toolsUsed: [],
    expects: question.expects,
    rejects: question.rejects,
    facts: config.facts,
    misstatements: config.misstatements,
    provenance: { hasMatchers: false, match: () => false },
  });
  return {
    verdict: trial.verdict,
    misstatementsHit: trial.misstatementsHit,
    factsMissed: trial.factsMissed,
  };
}

export function runExampleTests(config: Config): ExampleTestReport {
  const questions: QuestionExampleReport[] = [];
  let total = 0;
  let mismatches = 0;

  for (const question of config.questions) {
    const examples = question.examples;
    if (
      !examples ||
      (examples.pass.length === 0 && examples.fail.length === 0)
    ) {
      continue;
    }
    const hasRejects = question.rejects.length > 0;
    const results: ExampleResult[] = [];

    for (const response of examples.pass) {
      const ev = evaluate(question, config, response);
      const ok = ev.verdict === "YES";
      const reasons: string[] = [];
      if (!ok) {
        if (ev.factsMissed.length > 0) {
          reasons.push(`missing facts: ${ev.factsMissed.join(", ")}`);
        }
        if (ev.misstatementsHit.length > 0) {
          reasons.push(
            `tripped misstatement: ${ev.misstatementsHit.join(", ")}`,
          );
        }
        if (reasons.length === 0)
          reasons.push(`expected YES, got ${ev.verdict}`);
      }
      results.push({
        kind: "pass",
        response,
        verdict: ev.verdict,
        ok,
        reasons,
      });
      total++;
      if (!ok) mismatches++;
    }

    for (const response of examples.fail) {
      const ev = evaluate(question, config, response);
      const ok = hasRejects
        ? ev.misstatementsHit.length > 0
        : ev.verdict !== "YES";
      const reasons: string[] = ok
        ? []
        : [
            hasRejects
              ? "fail example did not trip any rejects rule (it must hit a misstatement)"
              : "expected not-YES, but the contract treated it as a pass",
          ];
      results.push({
        kind: "fail",
        response,
        verdict: ev.verdict,
        ok,
        reasons,
      });
      total++;
      if (!ok) mismatches++;
    }

    questions.push({ question: question.id, results });
  }

  return { questions, total, mismatches };
}
