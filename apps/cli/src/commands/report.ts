import path from "node:path";
import {
  formatJSON,
  formatMarkdown,
  formatReport,
  type RunReport,
} from "@pickled-dev/core";
import chalk from "chalk";

export interface ReportOptions {
  format?: string;
  json?: boolean;
  output?: string;
  verbose?: boolean;
}

type Format = "terminal" | "markdown" | "json";

/** --json is shorthand for --format json. An explicit --format wins. */
export function resolveReportFormat(options: ReportOptions): Format {
  if (options.format && options.format !== "terminal") {
    return options.format as Format;
  }
  if (options.json) return "json";
  return (options.format as Format) ?? "terminal";
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function fail(detail: string): never {
  throw new Error(
    `Not a Pickled report (${detail}). Pass a file saved with \`pickled check\`/\`build --output\`.`,
  );
}

const VERDICTS = new Set(["YES", "PARTIAL", "NO"]);
const SUMMARY_FIELDS = [
  "total",
  "yes",
  "partial",
  "no",
  "errors",
  "score",
] as const;

/**
 * Parse and validate a saved receipt. `report` only re-renders receipts that
 * `check`/`build --output` produced, so a file that is not a RunReport is a
 * user error with a clear message, never a stack trace or `undefined / 100`
 * output. Validation is the single gate: it checks every field the renderers
 * dereference (down through trials/attempts), so a receipt that passes here
 * cannot crash or render garbage.
 */
export function parseReport(text: string): RunReport {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      "Not valid JSON. Pass a report saved with `pickled check`/`build --output`.",
    );
  }
  return validateReport(data);
}

export function validateReport(data: unknown): RunReport {
  if (!isObject(data)) fail("not a JSON object");
  const kind = data.kind;
  if (kind !== "questions" && kind !== "builds") {
    fail('`kind` must be "questions" or "builds"');
  }
  if (!isObject(data.product) || typeof data.product.name !== "string") {
    fail("missing `product.name`");
  }
  if (!Array.isArray(data.sources)) fail("`sources` must be an array");
  if (!isObject(data.facts)) fail("`facts` must be an object");
  if (!isObject(data.misstatements)) fail("`misstatements` must be an object");

  if (!isObject(data.summary)) fail("`summary` must be an object");
  for (const field of SUMMARY_FIELDS) {
    if (!isNumber(data.summary[field]))
      fail(`\`summary.${field}\` must be a number`);
  }
  if (data.threshold !== undefined && !isNumber(data.threshold)) {
    fail("`threshold` must be a number");
  }

  const tasks = kind === "questions" ? data.questions : data.builds;
  if (!Array.isArray(tasks)) fail(`\`${kind}\` must be an array`);
  for (const task of tasks) validateTask(task, kind);

  return data as RunReport;
}

function validateTask(task: unknown, kind: "questions" | "builds"): void {
  if (!isObject(task)) fail(`each ${kind} entry must be an object`);
  const titleKey = kind === "questions" ? "question" : "goal";
  if (typeof task[titleKey] !== "string") {
    fail(`a ${kind} entry is missing \`${titleKey}\``);
  }
  if (!Array.isArray(task.cells)) fail(`a ${kind} entry is missing \`cells\``);
  for (const cell of task.cells) validateCell(cell, kind);
}

function validateCell(cell: unknown, kind: "questions" | "builds"): void {
  if (!isObject(cell)) fail("a cell must be an object");
  if (
    !isObject(cell.coord) ||
    typeof cell.coord.agent !== "string" ||
    typeof cell.coord.context !== "string"
  ) {
    fail("a cell is missing `coord.agent`/`coord.context`");
  }
  if (!VERDICTS.has(cell.verdict as string)) {
    fail("a cell has an invalid `verdict`");
  }
  if (kind === "questions") {
    if (!isNumber(cell.passedTrials) || !isNumber(cell.totalTrials)) {
      fail("a cell is missing trial counts");
    }
    if (cell.verdict === "PARTIAL" && !isNumber(cell.meanCoverage)) {
      fail("a partial cell is missing `meanCoverage`");
    }
    if (!Array.isArray(cell.trials)) fail("a cell is missing `trials`");
    for (const trial of cell.trials) validateTrial(trial);
  } else {
    if (!isNumber(cell.passedAttempts) || !isNumber(cell.totalAttempts)) {
      fail("a cell is missing attempt counts");
    }
    if (!Array.isArray(cell.attempts)) fail("a cell is missing `attempts`");
    for (const attempt of cell.attempts) validateAttempt(attempt);
  }
}

function validateTrial(trial: unknown): void {
  if (!isObject(trial)) fail("a trial must be an object");
  // The markdown renderer iterates these arrays for scored trials.
  if (trial.status === "scored") {
    for (const key of ["factsMissed", "misstatementsHit", "toolsUsed"]) {
      if (!Array.isArray(trial[key]))
        fail(`a scored trial is missing \`${key}\``);
    }
  } else if (trial.status !== "error") {
    fail('a trial `status` must be "scored" or "error"');
  }
}

function validateAttempt(attempt: unknown): void {
  if (!isObject(attempt)) fail("an attempt must be an object");
  if (typeof attempt.status !== "string")
    fail("an attempt is missing `status`");
  // Optional, but when present the renderer iterates them.
  if (attempt.commands !== undefined && !Array.isArray(attempt.commands)) {
    fail("an attempt `commands` must be an array");
  }
  if (
    attempt.changedFiles !== undefined &&
    !Array.isArray(attempt.changedFiles)
  ) {
    fail("an attempt `changedFiles` must be an array");
  }
}

/**
 * Render a saved receipt. JSON re-slims by default, so re-rendering a verbose
 * forensic receipt as `--format json` produces a CI-safe one (the sanitize
 * path); `--verbose` keeps full evidence. terminal/markdown never carry it.
 */
export function renderSaved(
  report: RunReport,
  format: Format,
  verbose: boolean,
): string {
  if (format === "json") return formatJSON(report, { verbose });
  if (format === "markdown") return formatMarkdown(report);
  return formatReport(report);
}

/**
 * `pickled report <file>`: re-render a saved receipt without rerunning agents.
 * Auto-detects questions vs builds from the receipt's `kind`. Presentational
 * only: the gate decision lives in `check`/`build`, so this always exits 0 on a
 * readable receipt (non-zero only on missing/invalid input).
 */
export async function report(
  file: string,
  options: ReportOptions,
): Promise<void> {
  const format = resolveReportFormat(options);
  const resolved = path.resolve(file);
  const handle = Bun.file(resolved);
  if (!(await handle.exists())) {
    console.error(chalk.red(`No such file: ${file}`));
    process.exit(1);
  }

  let parsed: RunReport;
  try {
    parsed = parseReport(await handle.text());
  } catch (error) {
    console.error(chalk.red(error instanceof Error ? error.message : error));
    process.exit(1);
  }

  const rendered = renderSaved(parsed, format, options.verbose ?? false);
  if (options.output) {
    await Bun.write(options.output, `${rendered}\n`);
  } else {
    await writeStdout(`${rendered}\n`);
  }
}

function writeStdout(text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    process.stdout.write(text, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}
