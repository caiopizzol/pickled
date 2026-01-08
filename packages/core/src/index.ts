// Check
export type { CheckOptions } from "./check.js";
export { runCheck } from "./check.js";

// Config
export { loadConfig } from "./config.js";

// Reporter
export { formatCheckJSON, printCheckReport } from "./reporter.js";

// Sources
export { fetchDocs, getCodebaseSource } from "./sources.js";

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
  Answerable,
  ApiProvider,
  CheckConfig,
  CheckReport,
  CliProvider,
  Context,
  DocSource,
  DocSourceType,
  DocsConfig,
  IdeProvider,
  MatrixConfig,
  McpServerConfig,
  Scenario,
  ScenarioResult,
  Target,
  TargetCategory,
  ToolInfo,
} from "./types.js";

// Validator
export type { ValidationResult } from "./validator.js";
export { parseValidation } from "./validator.js";
