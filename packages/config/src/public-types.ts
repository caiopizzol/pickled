/**
 * The public pickled.yml schema (v2). This is the only shape a user writes.
 * `loadConfig` validates it and resolves it into the internal domain model
 * (see transform.ts / types.ts).
 *
 * v2 is a hard break from v1, and the v2 nouns are canonical end to end: there
 * is no compilation back into v1 `scenarios`/`toolsets`/`expected`. Removed:
 * `tasks`, `kind`, `access`, `checks.mustMention`/`mustMentionOneOf`/
 * `mustNotMention`, the flat `verify: string[]`, the top-level `threshold`, and
 * the `## Sources` citation contract. The vocabulary is product-facing and
 * split by job: product / sources / agents / contexts / facts / misstatements /
 * questions / builds / thresholds.
 */
export interface PublicConfig {
  /** Schema gate. Must be the literal 2; a v1 config is rejected with a migration note. */
  schemaVersion: 2;
  product: { name: string; description: string };
  /** Public context artifacts by id. The key inside each value names its kind. */
  sources?: Record<string, PublicSource>;
  /** The agents (interfaces) that answer or build. */
  agents: Record<string, PublicAgent>;
  /** Named delivery paths: how (or whether) a source reaches the agent. */
  contexts: Record<string, PublicContext>;
  /** Reusable product truths a question can require. The coverage axis. */
  facts?: Record<string, PublicFact>;
  /** Reusable wrong claims a question can forbid. The precision / anti-hallucination axis. */
  misstatements?: Record<string, PublicMisstatement>;
  /** Source-legibility probes: can the agent surface the facts it needs from a context. */
  questions?: PublicQuestion[];
  /** Implementation proofs: can the agent edit a workspace and pass the verifier. */
  builds?: PublicBuild[];
  /** Per-kind run gates. `pickled check` gates on questions; `pickled build` on builds. */
  thresholds?: { questions?: number; builds?: number };
}

/**
 * A registered source. The key names the kind so the entry is unambiguous:
 * `url` for a fetched URL, `path` for a local file, `codebase` for a globbed
 * tree (the internal audience: comments and JSDoc as prompt surface). The TS
 * union is not sufficient at runtime; the validator enforces exactly one kind
 * per entry. `exclude`/`maxBytes` apply only to the codebase form.
 */
export type PublicSource =
  | { url: string }
  | { path: string }
  | { codebase: string; exclude?: string[]; maxBytes?: number };

export interface PublicAgent {
  provider: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  maxTurns?: number;
}

/**
 * A named delivery path, discriminated by mode so the type teaches the shape.
 * The validator still runtime-checks (YAML is untyped), but authoring a config
 * in TS (e.g. test fixtures) gets precise feedback:
 * - memory: prior-knowledge baseline; no source, no servers.
 * - inject: source content placed in the run context; source required.
 * - web: agent must use web tools; source optional (absent = open web discovery).
 * - mcp: agent must use MCP tools; servers required, source optional (a label
 *   when the server is itself the source). HTTP transport only.
 */
export type PublicContext =
  | { mode: "memory" }
  | { mode: "inject"; source: string }
  | { mode: "web"; source?: string }
  | {
      mode: "mcp";
      source?: string;
      servers: Record<
        string,
        { url: string; headers?: Record<string, string> }
      >;
    };

/**
 * Deterministic substring match. Satisfied iff every declared `allOf` entry is
 * present AND, when `anyOf` is declared, at least one `anyOf` entry is present.
 * At least one of `allOf`/`anyOf` must be declared. Matching is normalized
 * (case-folded, whitespace-collapsed) so phrasing, not casing, decides.
 */
export interface PublicMatch {
  allOf?: string[];
  anyOf?: string[];
}

/** A product truth: a human-readable statement plus the substrings that evidence it. */
export interface PublicFact {
  statement: string;
  match: PublicMatch;
}

/** A wrong claim: `statement` describes the error; `match` detects it in the answer. */
export interface PublicMisstatement {
  statement: string;
  match: PublicMatch;
}

/**
 * A source-legibility probe. Scores fact coverage via `expects` and vetoes on
 * any `rejects` misstatement. At least one of `expects`/`rejects` is required.
 * When `rejects` is declared, non-empty `examples.pass` AND `examples.fail` are
 * required: the pass example proves the veto does not fire on a correct answer
 * (e.g. "use bunx, not npm install"), the fail example proves it fires on the
 * wrong one. `examples` are scored offline by `pickled test`, before any paid run.
 */
export interface PublicQuestion {
  id: string;
  question: string;
  agents: string[];
  contexts: string[];
  /** Fact ids the answer must support (coverage). */
  expects?: string[];
  /** Misstatement ids the answer must not make (hard veto). */
  rejects?: string[];
  examples?: { pass?: string[]; fail?: string[] };
}

export interface PublicWorkspace {
  /** Fixture directory the agent edits, relative to pickled.yml. */
  path: string;
  /** Commands run to prepare the fixture before the agent (e.g. install). */
  setup?: string[];
}

export interface PublicCommand {
  /** Optional label for receipts; defaults to `run`. */
  name?: string;
  run: string;
}

/**
 * SWE-bench-style verifier. `failToPass` must fail on the untouched fixture and
 * pass after the agent (proof the task was actually done). `passToPass` must
 * pass both before and after (regression guard). Preflight asserts both halves
 * on the baseline, so a vacuous or impossible verifier is caught as a fixture
 * error rather than scored as the agent failing.
 */
export interface PublicVerifier {
  failToPass: PublicCommand[];
  passToPass?: PublicCommand[];
}

/**
 * An implementation proof. The agent edits `workspace`; success is the
 * verifier, scored k/n over `trials`. `requires` links to fact ids purely for
 * diagnostic reporting (which probe failed alongside the build).
 * `referenceSolution.patch` is the optional positive control: a patch path
 * that, applied to the untouched fixture, must pass the verifier, proving the
 * bar is reachable. Absent, the report marks the verifier unproven. (A
 * `{ directory }` form may be added later.)
 */
export interface PublicBuild {
  id: string;
  goal: string;
  agents: string[];
  contexts: string[];
  trials?: number;
  requires?: string[];
  workspace: PublicWorkspace;
  verifier: PublicVerifier;
  referenceSolution?: { patch: string };
}
