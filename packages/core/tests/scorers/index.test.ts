import { describe, expect, test } from "bun:test";
import type { Fact, Misstatement } from "@pickled-dev/config";
import {
  aggregateQuestionCell,
  matchSatisfied,
  scoreQuestionTrial,
} from "../../src/scorers/index.js";
import type { QuestionTrial, ScoredTrial } from "../../src/types.js";

const FACTS: Record<string, Fact> = {
  install: { statement: "install", match: { allOf: ["bunx pickled"] } },
  cmd: { statement: "command", match: { anyOf: ["check", "build"] } },
};
const MISS: Record<string, Misstatement> = {
  npm: { statement: "npm", match: { anyOf: ["npm install pickled"] } },
};

const NO_PROVENANCE = { hasMatchers: false, match: () => false };

describe("matchSatisfied", () => {
  test("allOf requires every substring (normalized)", () => {
    expect(
      matchSatisfied("Run BUNX   Pickled now", { allOf: ["bunx pickled"] }),
    ).toBe(true);
    expect(matchSatisfied("run pickled", { allOf: ["bunx pickled"] })).toBe(
      false,
    );
  });

  test("anyOf requires at least one", () => {
    expect(matchSatisfied("use build", { anyOf: ["check", "build"] })).toBe(
      true,
    );
    expect(matchSatisfied("use deploy", { anyOf: ["check", "build"] })).toBe(
      false,
    );
  });

  test("allOf and anyOf combine (both must hold)", () => {
    const m = { allOf: ["bunx"], anyOf: ["check", "build"] };
    expect(matchSatisfied("bunx ... check", m)).toBe(true);
    expect(matchSatisfied("bunx only", m)).toBe(false);
    expect(matchSatisfied("check only", m)).toBe(false);
  });
});

function score(args: {
  response: string;
  expects?: string[];
  rejects?: string[];
  toolsUsed?: string[];
  provenance?: { hasMatchers: boolean; match: (t: string) => boolean };
}): ScoredTrial {
  return scoreQuestionTrial({
    response: args.response,
    toolsUsed: args.toolsUsed ?? [],
    expects: args.expects ?? [],
    rejects: args.rejects ?? [],
    facts: FACTS,
    misstatements: MISS,
    provenance: args.provenance ?? NO_PROVENANCE,
  });
}

describe("scoreQuestionTrial - coverage", () => {
  test("all expected facts covered -> YES, coverage 100", () => {
    const t = score({
      response: "bunx pickled check",
      expects: ["install", "cmd"],
    });
    expect(t.verdict).toBe("YES");
    expect(t.passed).toBe(true);
    expect(t.coverage).toBe(100);
    expect(t.factsCovered).toEqual(["install", "cmd"]);
  });

  test("some covered -> PARTIAL, coverage reflects fraction", () => {
    const t = score({ response: "bunx pickled", expects: ["install", "cmd"] });
    expect(t.verdict).toBe("PARTIAL");
    expect(t.coverage).toBe(50);
    expect(t.factsMissed).toEqual(["cmd"]);
  });

  test("none covered -> NO", () => {
    const t = score({ response: "irrelevant", expects: ["install", "cmd"] });
    expect(t.verdict).toBe("NO");
    expect(t.coverage).toBe(0);
  });
});

describe("scoreQuestionTrial - veto", () => {
  test("a misstatement hit forces NO regardless of coverage", () => {
    const t = score({
      response: "bunx pickled check but also npm install pickled",
      expects: ["install", "cmd"],
      rejects: ["npm"],
    });
    expect(t.verdict).toBe("NO");
    expect(t.misstatementsHit).toEqual(["npm"]);
  });

  test("rejects-only question with no hit and provenance ok -> YES", () => {
    const t = score({
      response: "use bunx, not the old way",
      rejects: ["npm"],
    });
    expect(t.verdict).toBe("YES");
    expect(t.coverage).toBe(100); // no expects => vacuously full
  });

  test("provenance failure forces NO", () => {
    const t = score({
      response: "bunx pickled check",
      expects: ["install", "cmd"],
      toolsUsed: [],
      provenance: { hasMatchers: true, match: (x) => x === "WebSearch" },
    });
    expect(t.verdict).toBe("NO");
    expect(t.provenanceOk).toBe(false);
  });

  test("provenance satisfied when the expected tool was used", () => {
    const t = score({
      response: "bunx pickled check",
      expects: ["install", "cmd"],
      toolsUsed: ["WebSearch"],
      provenance: { hasMatchers: true, match: (x) => x === "WebSearch" },
    });
    expect(t.verdict).toBe("YES");
    expect(t.provenanceOk).toBe(true);
  });
});

function cell(trials: QuestionTrial[]) {
  return aggregateQuestionCell({
    coord: { agent: "a", context: "c" },
    mode: "memory",
    source: null,
    trials,
  });
}

const scored = (
  verdict: "YES" | "PARTIAL" | "NO",
  coverage: number,
): ScoredTrial => ({
  status: "scored",
  verdict,
  passed: verdict === "YES",
  coverage,
  factsCovered: [],
  factsMissed: [],
  misstatementsHit: verdict === "NO" && coverage === 0 ? [] : [],
  provenanceOk: true,
  toolsUsed: [],
  response: "",
});

describe("aggregateQuestionCell", () => {
  test("all YES -> YES, passRate 100", () => {
    const c = cell([scored("YES", 100), scored("YES", 100)]);
    expect(c.verdict).toBe("YES");
    expect(c.passedTrials).toBe(2);
    expect(c.totalTrials).toBe(2);
    expect(c.passRate).toBe(100);
    expect(c.meanCoverage).toBe(100);
  });

  test("mixed YES/PARTIAL -> PARTIAL with partial passRate", () => {
    const c = cell([scored("YES", 100), scored("PARTIAL", 50)]);
    expect(c.verdict).toBe("PARTIAL");
    expect(c.passedTrials).toBe(1);
    expect(c.passRate).toBe(50);
    expect(c.meanCoverage).toBe(75);
  });

  test("all NO -> NO", () => {
    const c = cell([scored("NO", 0), scored("NO", 0)]);
    expect(c.verdict).toBe("NO");
    expect(c.passedTrials).toBe(0);
  });

  test("a vetoed trial contributes 0 to meanCoverage", () => {
    const vetoed: ScoredTrial = {
      status: "scored",
      verdict: "NO",
      passed: false,
      coverage: 80,
      factsCovered: [],
      factsMissed: [],
      misstatementsHit: ["npm"],
      provenanceOk: true,
      toolsUsed: [],
      response: "",
    };
    const c = cell([scored("YES", 100), vetoed]);
    expect(c.verdict).toBe("PARTIAL");
    expect(c.meanCoverage).toBe(50); // (100 + 0) / 2
  });

  test("all-errored cell carries error and zero counts", () => {
    const c = cell([
      { status: "error", error: "boom" },
      { status: "error", error: "boom2" },
    ]);
    expect(c.error).toBe("boom");
    expect(c.totalTrials).toBe(0);
    expect(c.verdict).toBe("NO");
  });

  test("error trials are excluded from the denominator", () => {
    const c = cell([scored("YES", 100), { status: "error", error: "x" }]);
    expect(c.totalTrials).toBe(1);
    expect(c.passedTrials).toBe(1);
    expect(c.passRate).toBe(100);
  });
});
