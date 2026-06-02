/**
 * The public pickled.yml schema (v1). This is the only shape a user writes.
 * `loadConfig` validates it, then compiles it into the internal `CheckConfig`
 * (see transform.ts). The vocabulary is product-facing: product / sources /
 * agents / access / tasks / checks / examples.
 */
export interface PublicConfig {
  product: { name: string; description: string };
  /** Public context artifacts, by id. Value is a URL or local path. */
  sources?: Record<string, string>;
  /** The agents (interfaces) that answer or build. */
  agents: Record<string, PublicAgent>;
  /** Named context-delivery paths: a (source, tools) pair. */
  access: Record<string, PublicAccess>;
  tasks: PublicTask[];
  threshold?: number;
}

export interface PublicAgent {
  provider: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  maxTurns?: number;
}

export interface PublicAccess {
  /** A registered source id, or "none" for the no-context baseline. */
  source: string;
  tools: "none" | "web" | "mcp";
  /** Required when tools is "mcp"; forbidden otherwise. HTTP transport only. */
  servers?: Record<string, { url: string; headers?: Record<string, string> }>;
}

export interface PublicChecks {
  /** All must appear (substring). */
  mustMention?: string[];
  /** Each group is satisfied if at least one of its values appears. */
  mustMentionOneOf?: Array<{ label: string; values: string[] }>;
  /** None may appear (substring). */
  mustNotMention?: string[];
}

/** A build task's throwaway fixture (build tasks only). */
export interface PublicWorkspace {
  /** Fixture directory the agent edits, relative to pickled.yml. */
  path: string;
  /** Commands run to prepare the fixture before the agent (e.g. install). */
  setup?: string[];
}

/**
 * The public unit of work: an intent a developer cares about. `kind` selects
 * how success is proven. "answer" (the default) proves it with deterministic
 * text `checks`; "build" proves it by editing a `workspace` and running
 * `verify` commands. The two contracts do not mix: a build task forbids
 * `checks`/`examples`, an answer task forbids `workspace`/`verify`/`trials`.
 */
export interface PublicTask {
  id: string;
  /** The question to answer, or the work to build. */
  prompt: string;
  /**
   * "answer" (default) or "build". Defaults to "answer" only when no
   * build-only field is present; a task carrying workspace/verify/trials
   * without `kind: build` is rejected (build is never inferred from shape).
   */
  kind?: "answer" | "build";
  agents: string[];
  access: string[];
  /** Required on answer tasks; forbidden on build tasks (verify is the contract). */
  checks?: PublicChecks;
  /** Offline sample answers for `pickled test` (answer tasks only). */
  examples?: { pass?: string[]; fail?: string[] };
  /** Build tasks only: the fixture the agent edits. */
  workspace?: PublicWorkspace;
  /** Build tasks only: commands that must pass after the agent stops. */
  verify?: string[];
  /** Build tasks only: independent trials per cell (default 1). */
  trials?: number;
}
