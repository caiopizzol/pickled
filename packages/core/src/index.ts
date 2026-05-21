// Config
export { loadConfig } from "@pickled-dev/config";

// Audit
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

// Check
export type { CheckOptions } from "./check.js";
export { runCheck } from "./check.js";
// Report status (shared scenario-status helper)
export type { ScenarioStatus, StatusTone } from "./report-status.js";
export { getScenarioStatus } from "./report-status.js";
// Reporter
export {
  formatCheckJSON,
  formatCheckReport,
  printCheckReport,
} from "./reporter.js";

// Scorers
export type {
  Answerable,
  Citation,
  CitationScore,
  ScoreInput,
  TrapDetails,
  TrapHit,
} from "./scorers/index.js";
export {
  parseCitations,
  scoreCitations,
  scoreTraps,
} from "./scorers/index.js";

// Sources
export { fetchAllSources, fetchSource } from "./sources.js";

// Targets
export type {
  ResolvedContext,
  RunOptions,
  TargetResult,
  TargetRunner,
} from "./targets/index.js";
export {
  createTarget,
  DEFAULT_TARGET,
  resolveTarget,
} from "./targets/index.js";

// Types
export type {
  CheckReport,
  CitationDetails,
  ScenarioResult,
  ToolInfo,
} from "./types.js";
