import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { Config } from "@pickled-dev/config";
import {
  formatJSON,
  formatMarkdown,
  loadConfig,
  printReport,
  type RunReport,
  run,
  runPasses,
  type TaskKind,
} from "@pickled-dev/core";
import chalk from "chalk";

export interface CiOptions {
  questions?: boolean;
  builds?: boolean;
  questionsMaxCells?: string;
  buildsMaxCells?: string;
  reportDir?: string;
  summaryFile?: string;
}

const KIND_LABEL: Record<TaskKind, string> = {
  question: "questions",
  build: "builds",
};

/**
 * Which kinds to run. With no `--questions`/`--builds` flag, run both kinds the
 * config declares. With either flag, run only the requested kind(s). A kind with
 * no configured tasks is always skipped (the caller warns when it was asked for).
 */
export function selectKinds(
  config: Pick<Config, "questions" | "builds">,
  options: Pick<CiOptions, "questions" | "builds">,
): TaskKind[] {
  const explicit = Boolean(options.questions || options.builds);
  const kinds: TaskKind[] = [];
  if ((explicit ? options.questions : true) && config.questions.length > 0) {
    kinds.push("question");
  }
  if ((explicit ? options.builds : true) && config.builds.length > 0) {
    kinds.push("build");
  }
  return kinds;
}

function appendSummary(summaryFile: string, markdown: string): Promise<void> {
  return appendFile(path.resolve(summaryFile), `${markdown}\n\n`);
}

/** Job-summary note for a kind that errored before producing a receipt. */
export function failureNote(label: string, message: string): string {
  return `## ${label} did not run\n\n${message}`;
}

/**
 * Write the CI-safe JSON receipt for a run and, when a summary destination is
 * set, append its markdown summary. Receipt filename is the report kind
 * (`questions.json` / `builds.json`). Returns the receipt path.
 */
export async function emit(
  report: RunReport,
  reportDir: string,
  summaryFile?: string,
): Promise<string> {
  const dirAbs = path.resolve(reportDir);
  await mkdir(dirAbs, { recursive: true });
  const receiptPath = path.join(dirAbs, `${report.kind}.json`);
  await Bun.write(receiptPath, formatJSON(report));
  if (summaryFile) await appendSummary(summaryFile, formatMarkdown(report));
  return receiptPath;
}

/**
 * `pickled ci .`: run the configured questions and builds in one pass. For each
 * kind it writes a CI-safe JSON receipt to `--report-dir` and appends a markdown
 * summary to `--summary-file` (or `$GITHUB_STEP_SUMMARY` when set). Unlike
 * `check`/`build`, which exit on the first failed threshold, `ci` runs every
 * requested kind to completion so CI always gets every receipt, then exits
 * non-zero if any thresholded run failed (or could not run).
 */
export async function ci(
  targetPath: string,
  options: CiOptions,
): Promise<void> {
  const resolvedPath = path.resolve(targetPath);

  let config: Config;
  try {
    config = await loadConfig(resolvedPath);
  } catch (error) {
    console.error(chalk.red(error instanceof Error ? error.message : error));
    console.error();
    console.error(chalk.dim("Run `pickled init` to create a config file"));
    process.exit(1);
  }

  if (options.questions && config.questions.length === 0) {
    console.error(
      chalk.yellow("Requested --questions, but pickled.yml defines none."),
    );
  }
  if (options.builds && config.builds.length === 0) {
    console.error(
      chalk.yellow("Requested --builds, but pickled.yml defines none."),
    );
  }

  const kinds = selectKinds(config, options);
  if (kinds.length === 0) {
    console.log(
      chalk.dim("Nothing to run. Add questions or builds to pickled.yml."),
    );
    return;
  }

  const reportDir = options.reportDir ?? "pickled-reports";
  const summaryFile = options.summaryFile ?? process.env.GITHUB_STEP_SUMMARY;
  const maxCells: Record<TaskKind, number | undefined> = {
    question: parseMaxCells(options.questionsMaxCells, "--questions-max-cells"),
    build: parseMaxCells(options.buildsMaxCells, "--builds-max-cells"),
  };

  const tool = {
    name: config.product.name,
    description: config.product.description,
    path: resolvedPath,
  };

  let failed = false;
  for (const kind of kinds) {
    const label = KIND_LABEL[kind];
    console.log(chalk.bold(`\nRunning ${label}...`));

    let report: RunReport;
    try {
      report = await run(kind, tool, config, {
        maxCells: maxCells[kind],
        onProgress: (msg) => console.log(chalk.dim(`   ${msg}`)),
      });
    } catch (error) {
      // A kind that cannot run (cost gate, setup error) fails the gate but does
      // not stop the other kind: CI still gets that one's receipt. Record it in
      // the summary too, so the job summary explains an absent receipt.
      failed = true;
      const message = error instanceof Error ? error.message : String(error);
      console.error(chalk.red(`${label} did not run: ${message}`));
      if (summaryFile) {
        await appendSummary(summaryFile, failureNote(label, message)).catch(
          (writeError) =>
            console.error(
              chalk.yellow(
                `   could not write summary: ${writeError instanceof Error ? writeError.message : writeError}`,
              ),
            ),
        );
      }
      continue;
    }

    printReport(report);
    const receiptPath = await emit(report, reportDir, summaryFile);
    console.log(
      chalk.dim(`Receipt: ${path.relative(process.cwd(), receiptPath)}`),
    );

    if (runPasses(report.summary, report.threshold) === false) failed = true;
  }

  if (failed) process.exit(1);
}

function parseMaxCells(
  value: string | undefined,
  label: string,
): number | undefined {
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value) || Number(value) < 1) {
    console.error(
      chalk.red(`Invalid ${label} "${value}". Expected a positive integer.`),
    );
    process.exit(1);
  }
  return Number(value);
}
