import type { PublicConfig } from "./public-types.js";
import type {
  CheckConfig,
  ExpectedChecks,
  McpServerConfig,
  Scenario,
  Target,
  TargetCategory,
  ToolsetConfig,
} from "./types.js";

const PROVIDERS: Record<string, TargetCategory> = {
  openai: "api",
  anthropic: "api",
  "claude-code": "cli",
  "codex-cli": "cli",
};

/**
 * Validate the public config in its own vocabulary, so users never see
 * internal terms (scenario/target/toolset) in errors. The internal
 * `validate()` runs after compile as a backstop for synthesis bugs.
 */
export function validatePublicConfig(pub: PublicConfig): void {
  if (!pub || typeof pub !== "object") {
    throw new Error("pickled.yml: config must be an object");
  }
  if (!pub.product?.name) {
    throw new Error("pickled.yml: 'product.name' is required");
  }
  if (!Array.isArray(pub.questions) || pub.questions.length === 0) {
    throw new Error("pickled.yml: 'questions' must be a non-empty array");
  }

  const sourceIds = new Set(Object.keys(pub.sources ?? {}));
  if (sourceIds.has("none")) {
    throw new Error('pickled.yml: source id "none" is reserved');
  }

  const agentNames = new Set(Object.keys(pub.agents ?? {}));
  if (agentNames.size === 0) {
    throw new Error("pickled.yml: at least one agent is required");
  }
  for (const [name, agent] of Object.entries(pub.agents)) {
    if (!agent.provider || !agent.model) {
      throw new Error(
        `pickled.yml: agent "${name}" needs a provider and model`,
      );
    }
    if (!(agent.provider in PROVIDERS)) {
      throw new Error(
        `pickled.yml: agent "${name}" has unknown provider "${agent.provider}". Supported: ${Object.keys(PROVIDERS).join(", ")}`,
      );
    }
  }

  const accessNames = new Set(Object.keys(pub.access ?? {}));
  if (accessNames.has("none")) {
    throw new Error('pickled.yml: access id "none" is reserved');
  }
  for (const [name, access] of Object.entries(pub.access ?? {})) {
    if (access.source !== "none" && !sourceIds.has(access.source)) {
      throw new Error(
        `pickled.yml: access "${name}" references unknown source "${access.source}"`,
      );
    }
    if (!["none", "web", "mcp"].includes(access.tools)) {
      throw new Error(
        `pickled.yml: access "${name}" tools must be one of none | web | mcp`,
      );
    }
    const hasServers = access.servers && Object.keys(access.servers).length > 0;
    if (access.tools === "mcp" && !hasServers) {
      throw new Error(
        `pickled.yml: access "${name}" with tools: mcp requires a 'servers' map`,
      );
    }
    if (access.tools !== "mcp" && access.servers) {
      throw new Error(
        `pickled.yml: access "${name}" declares 'servers' but tools is "${access.tools}" (servers only valid with tools: mcp)`,
      );
    }
  }

  for (const q of pub.questions) {
    if (!q.id || !q.ask) {
      throw new Error("pickled.yml: every question needs 'id' and 'ask'");
    }
    if (!q.agents?.length) {
      throw new Error(
        `pickled.yml: question "${q.id}" needs at least one agent`,
      );
    }
    for (const a of q.agents) {
      if (!agentNames.has(a)) {
        throw new Error(
          `pickled.yml: question "${q.id}" references unknown agent "${a}"`,
        );
      }
    }
    if (!q.access?.length) {
      throw new Error(
        `pickled.yml: question "${q.id}" needs at least one access`,
      );
    }
    for (const a of q.access) {
      if (!accessNames.has(a)) {
        throw new Error(
          `pickled.yml: question "${q.id}" references unknown access "${a}"`,
        );
      }
    }
    const c = q.checks ?? {};
    if (
      !c.mustMention?.length &&
      !c.mustNotMention?.length &&
      !c.anyOf?.length
    ) {
      throw new Error(
        `pickled.yml: question "${q.id}" needs at least one of checks.mustMention / mustNotMention / anyOf`,
      );
    }
    for (const g of c.anyOf ?? []) {
      if (!g.label || !Array.isArray(g.values) || g.values.length === 0) {
        throw new Error(
          `pickled.yml: question "${q.id}" anyOf groups need a label and non-empty values`,
        );
      }
    }
  }
}

/**
 * Compile the validated public config into the internal CheckConfig the
 * runner/scorer/reporter consume. Pure function. Key mappings:
 * - product -> tool; sources -> docs.sources (string form)
 * - agents -> targets (category inferred from provider)
 * - access -> synthesized toolsets + one (source, toolset) pair each;
 *   source "none" stays the string "none" (no-context sentinel, never null);
 *   tools: none maps to the shared internal toolset "none".
 * - questions -> scenarios with matrix.accessPairs; checks -> expected
 *   (mustMention->includes, mustNotMention->excludes, anyOf->anyOf).
 */
export function compilePublicConfig(pub: PublicConfig): CheckConfig {
  const targets: Record<string, Target> = {};
  for (const [name, agent] of Object.entries(pub.agents)) {
    const target: Target = {
      category: PROVIDERS[agent.provider] ?? "api",
      provider: agent.provider,
      model: agent.model,
    };
    if (agent.temperature !== undefined) target.temperature = agent.temperature;
    if (agent.maxTokens !== undefined) target.maxTokens = agent.maxTokens;
    if (agent.maxTurns !== undefined) target.maxTurns = agent.maxTurns;
    targets[name] = target;
  }

  const toolsets: Record<string, ToolsetConfig> = {};
  const pairByAccess: Record<
    string,
    { source: string | null; toolset: string }
  > = {};
  for (const [name, access] of Object.entries(pub.access)) {
    if (access.tools === "none") {
      toolsets.none = {};
      pairByAccess[name] = { source: access.source, toolset: "none" };
    } else if (access.tools === "web") {
      toolsets[name] = { webSearch: true, webFetch: true };
      pairByAccess[name] = { source: access.source, toolset: name };
    } else {
      const mcpServers: Record<string, McpServerConfig> = {};
      for (const [label, server] of Object.entries(access.servers ?? {})) {
        const cfg: McpServerConfig = {
          type: (server.type as McpServerConfig["type"]) ?? "http",
          url: server.url,
        };
        if (server.headers) cfg.headers = server.headers;
        mcpServers[label] = cfg;
      }
      toolsets[name] = { mcpServers };
      pairByAccess[name] = { source: access.source, toolset: name };
    }
  }

  const scenarios: Scenario[] = pub.questions.map((q) => {
    const expected: ExpectedChecks = {};
    if (q.checks.mustMention?.length) expected.includes = q.checks.mustMention;
    if (q.checks.mustNotMention?.length)
      expected.excludes = q.checks.mustNotMention;
    if (q.checks.anyOf?.length) expected.anyOf = q.checks.anyOf;
    const scenario: Scenario = {
      name: q.id,
      prompt: q.ask,
      matrix: {
        interfaces: q.agents,
        accessPairs: q.access.map((a) => pairByAccess[a]),
      },
      expected,
    };
    if (q.examples) scenario.examples = q.examples;
    return scenario;
  });

  const config: CheckConfig = {
    tool: { name: pub.product.name, description: pub.product.description },
    targets,
    toolsets,
    scenarios,
  };
  if (pub.sources) config.docs = { sources: { ...pub.sources } };
  if (pub.threshold !== undefined) config.threshold = pub.threshold;
  return config;
}
