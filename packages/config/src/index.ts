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
  DocSourceType,
  DocsConfig,
  IdeProvider,
  MatrixConfig,
  McpServerConfig,
  ResolvedDocSource,
  Scenario,
  Target,
  TargetCategory,
  Trap,
} from "./types.js";
