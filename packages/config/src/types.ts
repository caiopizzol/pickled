/**
 * The internal domain model for v2: the validated, defaulted, normalized shape
 * the runners and reporter consume. It is deliberately distinct from the public
 * YAML shape (public-types.ts, what users write). After the resolver in
 * transform.ts runs, optionals are filled and illegal states are gone, so core
 * never has to ask "did validation fill this in?":
 * - Command.name defaults to its `run`.
 * - Build.trials defaults to 1; Build.requires defaults to [].
 * - Question.expects / rejects default to [].
 * - Verifier.passToPass defaults to [].
 * - Workspace.setup defaults to [].
 * - Context is a discriminated union; each mode carries exactly its fields.
 *
 * The v2 nouns are canonical; there is no v1 scenario/toolset/expected model
 * behind this.
 */

// ---- Execution layer (consumed by the target adapters in core) ----

export type TargetCategory = "api" | "cli" | "ide";
export type ApiProvider = "anthropic" | "openai" | "google";
export type CliProvider = "claude-code" | "codex-cli" | "amazon-q";
export type IdeProvider = "cursor" | "copilot" | "windsurf";

export interface McpServerConfig {
  type?: "stdio" | "sse" | "http";
  command?: string;
  args?: string[];
  url?: string;
  headers?: Record<string, string>;
}

/**
 * Resolved agent runtime config the target adapters consume (createTarget).
 * The public `agents` map resolves to this. Named `Target` because it is the
 * adapter-facing execution config; the product noun is "agent".
 */
export interface Target {
  category: TargetCategory;
  provider: string;
  model?: string;
  // CLI / Agent-SDK options
  allowedTools?: string[];
  disallowedTools?: string[];
  mcpServers?: Record<string, McpServerConfig>;
  permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan";
  maxTurns?: number;
  maxThinkingTokens?: number;
  maxBudgetUsd?: number;
  // API options
  temperature?: number;
  maxTokens?: number;
  // IDE options (future)
  workspaceContext?: boolean;
}

// ---- Sources ----

export type SourceKind = "url" | "file" | "codebase";

/**
 * A validated source declaration, discriminated by kind. The map key in
 * `Config.sources` is the id; content is loaded separately into ResolvedSource.
 */
export type Source =
  | { kind: "url"; url: string }
  | { kind: "file"; path: string }
  | { kind: "codebase"; path: string; exclude?: string[]; maxBytes?: number };

/**
 * A loaded source: declaration plus fetched content, consumed by the adapters
 * for injection. Field names match the former `ResolvedDocSource`
 * (`type`/`source`) so the adapter layer changes only an import, not field
 * access. `type` mirrors `Source.kind`; `source` is the origin location.
 */
export interface ResolvedSource {
  id: string;
  type: SourceKind;
  /** Human-readable label (filename, URL, or glob). */
  name: string;
  /** Origin: the URL or path it was loaded from. */
  source: string;
  content: string;
  /** For codebase sources, the relative paths the glob expanded to. */
  matchedFiles?: string[];
}

// ---- Matching ----

/**
 * Deterministic substring match. Satisfied iff every declared `allOf` entry is
 * present AND, when `anyOf` is declared, at least one `anyOf` entry is present.
 * Both stay optional: undefined means "no constraint on this side." They are
 * intentionally NOT defaulted to [] - an empty `anyOf` would mean "one of
 * nothing," which is never satisfiable. The validator requires at least one of
 * the two to be declared.
 */
export interface Match {
  allOf?: string[];
  anyOf?: string[];
}

/** A product truth: a human-readable statement plus the substrings that evidence it. */
export interface Fact {
  statement: string;
  match: Match;
}

/** A wrong claim: `statement` describes the error; `match` detects it. */
export interface Misstatement {
  statement: string;
  match: Match;
}

// ---- Contexts (discriminated after validation) ----

/**
 * A delivery path, fully resolved. Each mode carries exactly its fields, so
 * core can switch on `mode` without optional-field guards.
 */
export type Context =
  | { mode: "memory" }
  | { mode: "inject"; source: string }
  | { mode: "web"; source?: string }
  | {
      mode: "mcp";
      source?: string;
      servers: Record<string, McpServerConfig>;
    };

export type ContextMode = Context["mode"];

// ---- Builds ----

export interface Workspace {
  /** Fixture directory the agent edits, relative to pickled.yml. */
  path: string;
  /** Commands run to prepare the fixture before the agent. Defaulted to []. */
  setup: string[];
}

export interface Command {
  /** Receipt label; defaulted to `run` when the author omits it. */
  name: string;
  run: string;
}

export interface Verifier {
  failToPass: Command[];
  /** Regression guard; defaulted to []. */
  passToPass: Command[];
}

export interface Build {
  id: string;
  goal: string;
  agents: string[];
  contexts: string[];
  trials: number;
  /** Fact ids linked for diagnostic reporting. Defaulted to []. */
  requires: string[];
  workspace: Workspace;
  verifier: Verifier;
  /** Optional positive control: a patch that must pass the verifier on the baseline. */
  referenceSolution?: { patch: string };
}

// ---- Questions ----

export interface QuestionExamples {
  pass: string[];
  fail: string[];
}

export interface Question {
  id: string;
  question: string;
  agents: string[];
  contexts: string[];
  /** Fact ids the answer must support (coverage). Defaulted to []. */
  expects: string[];
  /** Misstatement ids the answer must not make (hard veto). Defaulted to []. */
  rejects: string[];
  /** Offline calibration for `pickled test`; required when `rejects` is non-empty. */
  examples?: QuestionExamples;
}

// ---- The canonical validated config ----

export interface Config {
  product: { name: string; description: string };
  /** Registered sources by id (declaration form; content loaded at run time). */
  sources: Record<string, Source>;
  /** Agents by id, resolved to adapter execution config. */
  agents: Record<string, Target>;
  /** Delivery paths by id. */
  contexts: Record<string, Context>;
  /** Reusable product truths by id (coverage axis). */
  facts: Record<string, Fact>;
  /** Reusable wrong claims by id (precision axis). */
  misstatements: Record<string, Misstatement>;
  questions: Question[];
  builds: Build[];
  thresholds: { questions?: number; builds?: number };
}
