export {
  renderAuditJSON,
  renderAuditMarkdown,
  renderAuditTerminal,
} from "./report.js";
export { scan } from "./scan.js";
export type {
  AuditConfig,
  AuditFinding,
  DocFile,
  DocPair,
  PairClass,
  ScanResult,
} from "./schema.js";
export {
  DEFAULT_AUDIT_CONFIG,
  DEFAULT_IGNORE_PATTERNS,
  resolveAuditConfig,
} from "./schema.js";
