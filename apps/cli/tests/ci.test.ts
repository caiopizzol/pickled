import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Config } from "@pickled-dev/config";
import type { RunReport } from "@pickled-dev/core";
import { emit, failureNote, selectKinds } from "../src/commands/ci.js";

/**
 * `pickled ci` orchestrates check + build into receipts and a summary. The run
 * itself spends agent tokens, so these cover the pure decision (which kinds to
 * run) and the receipt/summary plumbing (CI-safe by default), not a live run.
 */

function cfg(
  questions: number,
  builds: number,
): Pick<Config, "questions" | "builds"> {
  return {
    questions: Array.from({ length: questions }, (_, i) => ({ id: `q${i}` })),
    builds: Array.from({ length: builds }, (_, i) => ({ id: `b${i}` })),
  } as unknown as Pick<Config, "questions" | "builds">;
}

describe("selectKinds", () => {
  test("no flags runs both configured kinds", () => {
    expect(selectKinds(cfg(2, 1), {})).toEqual(["question", "build"]);
  });

  test("--questions runs questions only", () => {
    expect(selectKinds(cfg(2, 1), { questions: true })).toEqual(["question"]);
  });

  test("--builds runs builds only", () => {
    expect(selectKinds(cfg(2, 1), { builds: true })).toEqual(["build"]);
  });

  test("skips a kind the config does not declare", () => {
    expect(selectKinds(cfg(2, 0), {})).toEqual(["question"]);
  });

  test("a requested-but-absent kind yields nothing", () => {
    expect(selectKinds(cfg(0, 1), { questions: true })).toEqual([]);
  });

  test("an empty config runs nothing", () => {
    expect(selectKinds(cfg(0, 0), {})).toEqual([]);
  });
});

describe("failureNote", () => {
  test("renders a markdown note so an absent receipt is explained", () => {
    expect(failureNote("questions", "max cells exceeded")).toBe(
      "## questions did not run\n\nmax cells exceeded",
    );
  });
});

function questionReport(): RunReport {
  return {
    product: { name: "demo", description: "d" },
    sources: [],
    facts: {},
    misstatements: {},
    kind: "questions",
    questions: [
      {
        id: "q1",
        question: "how to install?",
        cells: [
          {
            coord: { agent: "a", context: "mem" },
            mode: "memory",
            source: null,
            verdict: "YES",
            passedTrials: 1,
            totalTrials: 1,
            passRate: 100,
            meanCoverage: 100,
            trials: [
              {
                status: "scored",
                verdict: "YES",
                passed: true,
                coverage: 100,
                factsCovered: [],
                factsMissed: [],
                misstatementsHit: [],
                provenanceOk: true,
                toolsUsed: [],
                response: "SECRET ANSWER",
              },
            ],
            reason: "ok",
          },
        ],
      },
    ],
    summary: { total: 1, yes: 1, partial: 0, no: 0, errors: 0, score: 100 },
  };
}

describe("emit", () => {
  const dirs: string[] = [];
  afterAll(async () => {
    await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
  });

  test("writes a CI-safe receipt and appends a markdown summary", async () => {
    const work = await mkdtemp(path.join(tmpdir(), "pickled-ci-"));
    dirs.push(work);
    const reportDir = path.join(work, "reports");
    const summaryFile = path.join(work, "summary.md");

    const receiptPath = await emit(questionReport(), reportDir, summaryFile);

    expect(receiptPath).toBe(path.join(reportDir, "questions.json"));
    const receipt = await readFile(receiptPath, "utf8");
    // Slim by default: the full agent answer never reaches the artifact.
    expect(receipt).not.toContain("SECRET ANSWER");
    expect(JSON.parse(receipt).summary.score).toBe(100);

    const summary = await readFile(summaryFile, "utf8");
    expect(summary).toContain("# pickled check");
    expect(summary).not.toContain("SECRET ANSWER");
  });

  test("without a summary file it writes only the receipt", async () => {
    const work = await mkdtemp(path.join(tmpdir(), "pickled-ci-"));
    dirs.push(work);
    const reportDir = path.join(work, "reports");

    const receiptPath = await emit(questionReport(), reportDir);

    expect(await readFile(receiptPath, "utf8")).toContain('"score": 100');
  });
});
