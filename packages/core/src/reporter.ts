import chalk from "chalk";
import {
  buildCellStatus,
  type CellStatus,
  questionCellStatus,
  runPasses,
  type StatusTone,
} from "./report-status.js";
import type {
  BuildAttempt,
  BuildCell,
  BuildProofResult,
  BuildProofStatus,
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

const PROOF_MARK: Record<BuildProofStatus, string> = {
  proven: chalk.green("✓ proven"),
  unproven: chalk.dim("- unproven"),
  broken: chalk.red("✗ broken"),
};

/**
 * Render `pickled build --verify-only`: one line per build, since the harness
 * proof (preflight + reference control) is agent/context-independent. No
 * scores, no run verdict; just whether each build's verifier is proven,
 * unproven (no reference solution declared), or broken (with the fault).
 */
export function formatBuildProof(
  productName: string,
  results: BuildProofResult[],
): string {
  const lines: string[] = [];
  lines.push(chalk.bold("pickled build --verify-only"));
  lines.push(LINE);
  lines.push(`Product: ${chalk.cyan(productName)}`);
  lines.push(`Build verifier proof: ${chalk.dim(String(results.length))}`);
  lines.push("");
  const width = results.reduce((w, r) => Math.max(w, r.id.length), 0);
  for (const r of results) {
    const note =
      r.status === "broken"
        ? `  ${chalk.dim(r.message ?? "")}`
        : r.status === "unproven"
          ? `  ${chalk.dim("no reference solution declared")}`
          : "";
    lines.push(`  ${r.id.padEnd(width)}  ${PROOF_MARK[r.status]}${note}`);
  }
  lines.push("");
  lines.push(LINE);
  const count = (s: BuildProofStatus) =>
    results.filter((r) => r.status === s).length;
  lines.push(
    chalk.dim(
      `${results.length} builds · ${count("proven")} proven · ${count("unproven")} unproven · ${count("broken")} broken`,
    ),
  );
  return lines.join("\n");
}

export interface FormatJSONOptions {
  verbose?: boolean;
}

/**
 * Render the RunReport as JSON. Raw and receipt-first. By default strips heavy
 * evidence (source content, full agent answers, per-trial transcripts, build
 * diffs, command stdout/stderr) so CI artifacts stay small and source text does
 * not leak: an agent answer can reproduce injected docs or private context, so
 * `response` is dropped alongside the transcripts. `verbose` keeps everything
 * for a forensic artifact.
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
          const { allResponses, response, ...rest } = t;
          void allResponses;
          void response;
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

/**
 * Render the RunReport as a CI-first markdown summary, designed to be piped into
 * a GitHub job summary (`$GITHUB_STEP_SUMMARY`). Pure function of the receipt:
 * labels, scores, and the run pass/fail decision all come from report-status.
 *
 * More diagnostic than the terminal renderer: it resolves missed facts and
 * fired misstatements to their statements, flags provenance failures, and lists
 * every build attempt with changed files and failed-command exit codes (the
 * terminal view shows only the first failed attempt's command names).
 *
 * Public-safe: like a CI artifact this can be read by anyone, so it never prints
 * full agent answers, transcripts, diffs, or command output. Use `--verbose`
 * JSON for that forensic detail.
 */
export function formatMarkdown(report: RunReport): string {
  const lines: string[] = [];
  const kindTitle =
    report.kind === "questions" ? "pickled check" : "pickled build";
  lines.push(`# ${kindTitle}\n`);
  lines.push(`Product: \`${report.product.name}\``);
  lines.push(
    report.sources.length > 0
      ? `Sources: ${report.sources.map((s) => `\`[${s.id}]\``).join(", ")}`
      : "Sources: none registered",
  );
  lines.push("");
  lines.push(overallMarkdown(report));
  lines.push("");
  lines.push(...summaryTable(report));

  if (report.kind === "questions") {
    for (const q of report.questions ?? []) {
      lines.push(`## ${q.question}\n`);
      for (const cell of q.cells)
        lines.push(...questionCellMarkdown(cell, report));
    }
  } else {
    for (const b of report.builds ?? []) {
      lines.push(`## ${b.goal}\n`);
      for (const cell of b.cells) lines.push(...buildCellMarkdown(cell));
    }
  }
  return lines.join("\n");
}

function overallMarkdown(report: RunReport): string {
  const { score, errors } = report.summary;
  const base = `**Overall: ${score} / 100**`;
  const passes = runPasses(report.summary, report.threshold);
  if (passes === null) return base;
  const verdict = passes ? "✅ run passes" : "❌ run fails";
  const errNote = errors > 0 ? ` · ${errors} errored` : "";
  return `${base} · threshold ${report.threshold}${errNote} · ${verdict}`;
}

function summaryTable(report: RunReport): string[] {
  const s = report.summary;
  const rows: Array<[string, number]> =
    report.kind === "questions"
      ? [
          ["Well grounded", s.yes],
          ["Partially grounded", s.partial],
          ["Ungrounded", s.no],
          ["Errored", s.errors],
        ]
      : [
          ["Built", s.yes],
          ["Partially built", s.partial],
          ["Did not build", s.no],
          ["Errored", s.errors],
        ];
  const out = ["| Result | Cells |", "|---|---|"];
  for (const [label, n] of rows) out.push(`| ${label} | ${n} |`);
  out.push("");
  return out;
}

function cellHeading(
  agent: string,
  context: string,
  status: CellStatus,
): string {
  const detail = status.detail ? `, ${status.detail}` : "";
  return `### ${agent} · ${context}\n${status.icon} ${status.label} (${status.rate}${detail})`;
}

/** Resolve a fact/misstatement id to its statement; fall back to the bare id. */
function statementFor(
  id: string,
  registry: Record<string, { statement: string }>,
): string {
  const statement = registry[id]?.statement;
  return statement ? `\`${id}\` ${statement}` : `\`${id}\``;
}

function questionCellMarkdown(cell: QuestionCell, report: RunReport): string[] {
  const out = [
    cellHeading(cell.coord.agent, cell.coord.context, questionCellStatus(cell)),
  ];
  if (cell.verdict === "YES") {
    out.push("");
    return out;
  }
  if (cell.reason) out.push(`- reason: ${cell.reason}`);

  const missing = new Set<string>();
  const misfired = new Set<string>();
  const tools = new Set<string>();
  let provenanceFailed = false;
  for (const t of cell.trials) {
    if (t.status !== "scored") continue;
    for (const f of t.factsMissed) missing.add(f);
    for (const m of t.misstatementsHit) misfired.add(m);
    for (const tool of t.toolsUsed) tools.add(tool);
    if (!t.provenanceOk) provenanceFailed = true;
  }
  for (const id of missing) {
    out.push(`- missing fact: ${statementFor(id, report.facts)}`);
  }
  for (const id of misfired) {
    out.push(`- misstatement: ${statementFor(id, report.misstatements)}`);
  }
  if (provenanceFailed) {
    out.push("- provenance: the configured tool path was not used (forced NO)");
  }
  if (tools.size > 0) out.push(`- tools: ${[...tools].join(", ")}`);
  out.push("");
  return out;
}

function buildCellMarkdown(cell: BuildCell): string[] {
  const out = [
    cellHeading(cell.coord.agent, cell.coord.context, buildCellStatus(cell)),
  ];
  if (cell.verdict === "YES" && cell.verifierProof !== "not_declared") {
    out.push("");
    return out;
  }
  if (cell.reason) out.push(`- reason: ${cell.reason}`);
  if (cell.verifierProof === "not_declared") {
    out.push("- verifier unproven (no reference solution declared)");
  }
  cell.attempts.forEach((a, i) => {
    out.push(`- attempt ${i + 1}: ${a.status}${attemptDetail(a)}`);
  });
  out.push("");
  return out;
}

function attemptDetail(a: BuildAttempt): string {
  const parts: string[] = [];
  if (a.reason) parts.push(a.reason);
  const failed = (a.commands ?? [])
    .filter((c) => !c.passed)
    .map((c) => `${c.name} (${c.group}, exit ${c.exitCode})`);
  if (failed.length > 0) parts.push(`failed: ${failed.join(", ")}`);
  const files = a.changedFiles ?? [];
  if (files.length > 0) {
    const named = files
      .slice(0, 10)
      .map((f) => `${f.status} ${f.path}`)
      .join(", ");
    const more = files.length > 10 ? `, +${files.length - 10} more` : "";
    parts.push(`files: ${named}${more}`);
  }
  return parts.length > 0 ? `; ${parts.join("; ")}` : "";
}
