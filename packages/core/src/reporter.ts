import chalk from "chalk";
import {
  buildCellStatus,
  questionCellStatus,
  runPasses,
  type StatusTone,
} from "./report-status.js";
import type {
  BuildCell,
  PlanSummary,
  QuestionCell,
  RunReport,
} from "./types.js";

const LINE = "─".repeat(55);
type ChalkFn = typeof chalk.green;

function tone(t: StatusTone): ChalkFn {
  if (t === "success") return chalk.green;
  if (t === "warning") return chalk.yellow;
  return chalk.red;
}

function overallColor(score: number): ChalkFn {
  if (score >= 70) return chalk.green;
  if (score >= 50) return chalk.yellow;
  return chalk.red;
}

export interface FormatOptions {
  title?: string;
}

/**
 * Render a RunReport for the terminal. Pure function of the receipt: all label,
 * score, and run-pass/fail decisions come from report-status, never from here.
 */
export function formatReport(
  report: RunReport,
  options: FormatOptions = {},
): string {
  const lines: string[] = [];
  const kindTitle =
    report.kind === "questions" ? "pickled check" : "pickled build";
  lines.push(chalk.bold(options.title ?? kindTitle));
  lines.push(LINE);
  lines.push(`Product: ${chalk.cyan(report.product.name)}`);
  lines.push(
    report.sources.length > 0
      ? `Sources: ${chalk.dim(report.sources.map((s) => `[${s.id}]`).join(", "))}`
      : `Sources: ${chalk.dim("none registered")}`,
  );

  const plan = report.plan;
  if (plan?.cells && !report.questions && !report.builds) {
    return formatPlan(plan, lines);
  }

  const taskCount = report.questions?.length ?? report.builds?.length ?? 0;
  lines.push(`Tasks: ${chalk.dim(String(taskCount))}`);
  lines.push("");

  if (report.kind === "questions") {
    for (const q of report.questions ?? []) {
      lines.push(`Task: ${q.question}`);
      for (const cell of q.cells) lines.push(...questionCellLines(cell));
      lines.push("");
    }
  } else {
    for (const b of report.builds ?? []) {
      lines.push(`Task: ${b.goal}`);
      for (const cell of b.cells) lines.push(...buildCellLines(cell));
      lines.push("");
    }
  }

  lines.push(LINE);
  lines.push(formatOverall(report));
  lines.push(chalk.dim(guidance(report)));
  return lines.join("\n");
}

function cellHead(
  agent: string,
  context: string,
  status: ReturnType<typeof questionCellStatus>,
): string {
  const color = tone(status.tone);
  const label = chalk.dim(`  [${agent} · ${context}]`);
  const detail = status.detail ? ` ${chalk.dim(`(${status.detail})`)}` : "";
  return `${label} ${color(`${status.icon} ${status.label} ${status.rate}`)}${detail}`;
}

function questionCellLines(cell: QuestionCell): string[] {
  const out = [
    cellHead(cell.coord.agent, cell.coord.context, questionCellStatus(cell)),
  ];
  if (cell.verdict !== "YES" && cell.reason) {
    out.push(chalk.dim(`      reason: ${cell.reason}`));
  }
  const tools = uniqueTools(cell);
  if (tools.length > 0) out.push(chalk.dim(`      tools: ${tools.join(", ")}`));
  return out;
}

function buildCellLines(cell: BuildCell): string[] {
  const out = [
    cellHead(cell.coord.agent, cell.coord.context, buildCellStatus(cell)),
  ];
  if (cell.verdict !== "YES" && cell.reason) {
    out.push(chalk.dim(`      reason: ${cell.reason}`));
  }
  const failed = cell.attempts.find((a) => a.status === "failed");
  const failing =
    failed?.commands
      ?.filter((cmd) => !cmd.passed)
      .map((cmd) => `${cmd.name} (${cmd.group})`) ?? [];
  if (failing.length > 0) {
    out.push(chalk.dim(`      failed: ${failing.join(", ")}`));
  }
  return out;
}

function uniqueTools(cell: QuestionCell): string[] {
  const set = new Set<string>();
  for (const t of cell.trials) {
    if (t.status === "scored") {
      for (const tool of t.toolsUsed) set.add(tool);
    }
  }
  return [...set];
}

function formatOverall(report: RunReport): string {
  const { score, errors } = report.summary;
  const base = `Overall: ${overallColor(score)(String(score))} / 100`;
  const passes = runPasses(report.summary, report.threshold);
  // No threshold: show the score and stop (errored cells are carried by the
  // per-cell receipts and the guidance line). See brand.md verdict layers.
  if (passes === null) return base;
  const verdict = passes ? chalk.green("run passes") : chalk.red("run fails");
  const errNote = errors > 0 ? ` · ${chalk.red(`${errors} errored`)}` : "";
  return `${base} · threshold ${report.threshold}${errNote} · ${verdict}`;
}

function guidance(report: RunReport): string {
  const s = report.summary;
  if (s.errors > 0) return "Some cells errored; review the receipts.";
  if (report.kind === "questions") {
    return s.yes === s.total
      ? "Every question met its checks."
      : "Review the answers that fell short of their checks.";
  }
  return s.yes === s.total
    ? "Every build passed verification."
    : "Review the build attempts that failed verification.";
}

function formatPlan(plan: PlanSummary, lines: string[]): string {
  const sampled = plan.selectedCells < plan.expandedCells;
  lines.push(
    `Cells: ${chalk.dim(`${plan.selectedCells} of ${plan.expandedCells}${sampled && plan.seed ? ` (sampled, seed=${plan.seed})` : ""}`)}`,
  );
  if (plan.selectedExecutions !== plan.selectedCells) {
    lines.push(`Executions: ${chalk.dim(String(plan.selectedExecutions))}`);
  }
  lines.push("");
  lines.push(
    chalk.bold(
      `Planned cells (${plan.selectedCells} of ${plan.expandedCells})`,
    ),
  );
  let current = "";
  for (const c of plan.cells ?? []) {
    if (c.task !== current) {
      current = c.task;
      lines.push(`  ${c.task}`);
    }
    const trials = c.trials ? ` ×${c.trials}` : "";
    lines.push(`    ${chalk.dim(`[${c.agent} · ${c.context}]${trials}`)}`);
  }
  lines.push("");
  lines.push(LINE);
  lines.push(
    chalk.dim("Dry-run: no agent calls. Re-run without --plan to execute."),
  );
  return lines.join("\n");
}

export function printReport(
  report: RunReport,
  options: FormatOptions = {},
): void {
  console.log(formatReport(report, options));
  console.log();
}

export interface FormatJSONOptions {
  verbose?: boolean;
}

/**
 * Render the RunReport as JSON. Raw and receipt-first. By default strips heavy
 * evidence (source content, per-trial transcripts, build diffs, command
 * stdout/stderr) so CI artifacts stay small and source text does not leak;
 * `verbose` keeps everything.
 */
export function formatJSON(
  report: RunReport,
  options: FormatJSONOptions = {},
): string {
  if (options.verbose) return JSON.stringify(report, null, 2);
  const slim: RunReport = {
    ...report,
    sources: report.sources.map((s) => ({ ...s, content: "" })),
    questions: report.questions?.map((q) => ({
      ...q,
      cells: q.cells.map((cell) => ({
        ...cell,
        trials: cell.trials.map((t) => {
          const { allResponses, ...rest } = t;
          void allResponses;
          return rest;
        }),
      })),
    })),
    builds: report.builds?.map((b) => ({
      ...b,
      cells: b.cells.map((cell) => ({
        ...cell,
        attempts: cell.attempts.map((a) => {
          const { diff, commands, ...rest } = a;
          void diff;
          return {
            ...rest,
            commands: commands?.map((cmd) => {
              const { stdout, stderr, ...cmdRest } = cmd;
              void stdout;
              void stderr;
              return cmdRest;
            }),
          };
        }),
      })),
    })),
  };
  return JSON.stringify(slim, null, 2);
}
