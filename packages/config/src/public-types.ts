/**
 * The public pickled.yml schema (v1). This is the only shape a user writes.
 * `loadConfig` validates it, then compiles it into the internal `CheckConfig`
 * (see transform.ts). The vocabulary is product-facing: product / sources /
 * agents / access / questions / checks / examples.
 */
export interface PublicConfig {
  product: { name: string; description: string };
  /** Public context artifacts, by id. Value is a URL or local path. */
  sources?: Record<string, string>;
  /** The agents (interfaces) that answer. */
  agents: Record<string, PublicAgent>;
  /** Named context-delivery paths: a (source, tools) pair. */
  access: Record<string, PublicAccess>;
  questions: PublicQuestion[];
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

export interface PublicQuestion {
  id: string;
  ask: string;
  agents: string[];
  access: string[];
  checks: PublicChecks;
  examples?: { pass?: string[]; fail?: string[] };
}
