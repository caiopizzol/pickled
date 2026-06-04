// Defaults (execution-layer constants consumed by core)
export {
  DEFAULT_ALLOWED_TOOLS,
  DEFAULT_DISALLOWED_TOOLS,
  DEFAULT_TARGET,
  EDIT_ALLOWED_TOOLS,
} from "./defaults.js";
// Loader
export { expandEnvVars, loadConfig } from "./loader.js";
// Public schema types (the YAML shape users write)
export type {
  PublicAgent,
  PublicBuild,
  PublicCommand,
  PublicConfig,
  PublicContext,
  PublicFact,
  PublicMatch,
  PublicMisstatement,
  PublicQuestion,
  PublicSource,
  PublicVerifier,
  PublicWorkspace,
} from "./public-types.js";
// Validation / resolution (exported for tests and tooling)
export { resolvePublicConfig, validatePublicConfig } from "./transform.js";
// Internal domain types (the normalized, validated model core consumes)
export type {
  ApiProvider,
  Build,
  CliProvider,
  Command,
  Config,
  Context,
  ContextMode,
  Fact,
  IdeProvider,
  Match,
  McpServerConfig,
  Misstatement,
  Question,
  QuestionExamples,
  ResolvedSource,
  Source,
  SourceKind,
  Target,
  TargetCategory,
  Verifier,
  Workspace,
} from "./types.js";
