// Types

// Defaults
export {
  DEFAULT_ALLOWED_TOOLS,
  DEFAULT_DISALLOWED_TOOLS,
  DEFAULT_TARGET,
} from "./defaults.js";
// Loader
export { loadConfig } from "./loader.js";
// Overrides
export { overrideTarget } from "./override.js";
export type {
  ApiProvider,
  CheckConfig,
  CliProvider,
  Context,
  DocSource,
  DocSourceEntry,
  DocSourceType,
  DocsConfig,
  ExpectedChecks,
  IdeProvider,
  MatrixConfig,
  McpServerConfig,
  NormalizedDocSource,
  ResolvedDocSource,
  Scenario,
  ScenarioMatrix,
  Target,
  TargetCategory,
  ToolsetConfig,
  Trap,
  VerifierConfig,
} from "./types.js";
export { normalizeDocSource } from "./types.js";
