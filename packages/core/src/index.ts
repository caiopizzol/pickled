// Config
export { loadConfig } from "@pickled-dev/config";

// Audit (dogfood; standalone doc-scan feature)
export type {
  AuditConfig,
  AuditFinding,
  DocFile,
  DocPair,
  PairClass,
  ScanResult,
} from "./audit/index.js";
export {
  DEFAULT_AUDIT_CONFIG,
  DEFAULT_IGNORE_PATTERNS,
  renderAuditJSON,
  renderAuditMarkdown,
  renderAuditTerminal,
  resolveAuditConfig,
  scan,
} from "./audit/index.js";

// Run
export type { CheckOptions } from "./check.js";
export { run, runBuild, runCheck } from "./check.js";

// Examples (pickled test)
export type {
  ExampleResult,
  ExampleTestReport,
  QuestionExampleReport,
} from "./examples.js";
export { runExampleTests } from "./examples.js";
// Planner
export type { CellFilter, PlannedCell, TaskKind } from "./planner.js";
export { cellExecutions, planCells, plannedCellKey } from "./planner.js";
// Report status + score/threshold policy (shared single source of truth)
export type { CellStatus, StatusTone } from "./report-status.js";
export {
  buildCellStatus,
  questionCellStatus,
  runPasses,
  summarizeBuilds,
  summarizeQuestions,
} from "./report-status.js";
// Reporter (renderers; pure functions of RunReport)
export type { FormatJSONOptions, FormatOptions } from "./reporter.js";
export { formatJSON, formatReport, printReport } from "./reporter.js";

// Scorer
export {
  aggregateQuestionCell,
  matchSatisfied,
  scoreQuestionTrial,
} from "./scorers/index.js";

// Sources
export { fetchAllSources, fetchSource } from "./sources.js";

// Targets
export type {
  PromptContext,
  RunOptions,
  TargetResult,
  TargetRunner,
} from "./targets/index.js";
export {
  createTarget,
  DEFAULT_TARGET,
  resolveTarget,
} from "./targets/index.js";

// Types (the receipt model)
export type {
  BuildAttempt,
  BuildCell,
  BuildResult,
  CellCoord,
  CommandReceipt,
  ErrorTrial,
  PlanSummary,
  QuestionCell,
  QuestionResult,
  QuestionTrial,
  ResolvedSource,
  RunReport,
  ScoredTrial,
  ToolInfo,
  Verdict,
  VerifierGroup,
  VerifierProof,
} from "./types.js";
