import type { PublicAgent, PublicConfig, PublicTask } from "./public-types.js";
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

const ALLOWED_TOP_LEVEL = new Set([
  "product",
  "sources",
  "agents",
  "access",
  "tasks",
  "threshold",
]);

/**
 * Validate the public config in its own vocabulary, so users never see
 * internal terms (scenario/target/toolset) in errors. The internal
 * `validate()` runs after compile as a backstop for synthesis bugs.
 */
export function validatePublicConfig(pub: PublicConfig): void {
  if (!pub || typeof pub !== "object") {
    throw new Error("pickled.yml: config must be an object");
  }
  // Hard rename (no alias): point old configs at the new vocabulary.
  if ("questions" in pub) {
    throw new Error(
      'pickled.yml: "questions" was renamed to "tasks" (and each question\'s "ask" to "prompt"). Rename the top-level key and update each entry.',
    );
  }
  for (const key of Object.keys(pub)) {
    if (!ALLOWED_TOP_LEVEL.has(key)) {
      throw new Error(
        `pickled.yml: unknown top-level key "${key}". Allowed: product, sources, agents, access, tasks, threshold.`,
      );
    }
  }
  if (!pub.product?.name) {
    throw new Error("pickled.yml: 'product.name' is required");
  }
  if (!Array.isArray(pub.tasks) || pub.tasks.length === 0) {
    throw new Error("pickled.yml: 'tasks' must be a non-empty array");
  }

  const sourceIds = new Set(Object.keys(pub.sources ?? {}));
  if (sourceIds.has("none")) {
    throw new Error('pickled.yml: source id "none" is reserved');
  }
  for (const [id, value] of Object.entries(pub.sources ?? {})) {
    if (typeof value !== "string" || value.length === 0) {
      throw new Error(
        `pickled.yml: source "${id}" must be a non-empty URL or file path string. Object sources (codebase globs, byte limits) are not part of the public schema yet.`,
      );
    }
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
    for (const [label, server] of Object.entries(access.servers ?? {})) {
      const url = (server as { url?: unknown }).url;
      if (typeof url !== "string" || !/^https?:\/\//.test(url)) {
        throw new Error(
          `pickled.yml: access "${name}" MCP server "${label}" needs an http(s) 'url'`,
        );
      }
      for (const key of Object.keys(server as Record<string, unknown>)) {
        if (key !== "url" && key !== "headers") {
          throw new Error(
            `pickled.yml: access "${name}" MCP server "${label}" has unsupported field "${key}". Public MCP servers accept only 'url' and 'headers' (HTTP transport).`,
          );
        }
      }
    }
  }

  for (const t of pub.tasks) {
    // Per-task migration nudge: ask -> prompt.
    if (t.id && (t as { ask?: unknown }).ask !== undefined) {
      throw new Error(
        `pickled.yml: task "${t.id}" uses "ask"; it was renamed to "prompt".`,
      );
    }
    if (!t.id || !t.prompt) {
      throw new Error("pickled.yml: every task needs 'id' and 'prompt'");
    }
    const kind = t.kind ?? "answer";
    if (kind !== "answer" && kind !== "build") {
      throw new Error(
        `pickled.yml: task "${t.id}" has unknown kind "${kind}". Use "answer" or "build".`,
      );
    }
    // Build is never inferred from shape: build-only fields require kind: build.
    if (
      kind !== "build" &&
      (t.workspace !== undefined ||
        t.verify !== undefined ||
        t.trials !== undefined)
    ) {
      throw new Error(
        `pickled.yml: task "${t.id}" has build-only fields (workspace/verify/trials) but kind is not "build". Set kind: build, or remove them.`,
      );
    }
    if (!t.agents?.length) {
      throw new Error(`pickled.yml: task "${t.id}" needs at least one agent`);
    }
    for (const a of t.agents) {
      if (!agentNames.has(a)) {
        throw new Error(
          `pickled.yml: task "${t.id}" references unknown agent "${a}"`,
        );
      }
    }
    if (!t.access?.length) {
      throw new Error(`pickled.yml: task "${t.id}" needs at least one access`);
    }
    for (const a of t.access) {
      if (!accessNames.has(a)) {
        throw new Error(
          `pickled.yml: task "${t.id}" references unknown access "${a}"`,
        );
      }
    }
    if (kind === "build") validateBuildTask(t, pub.agents);
    else validateAnswerTask(t);
  }
}

/** Answer tasks prove success with deterministic text checks. */
function validateAnswerTask(t: PublicTask): void {
  const c = t.checks ?? {};
  if (
    !c.mustMention?.length &&
    !c.mustNotMention?.length &&
    !c.mustMentionOneOf?.length
  ) {
    throw new Error(
      `pickled.yml: task "${t.id}" needs at least one of checks.mustMention / mustMentionOneOf / mustNotMention`,
    );
  }
  for (const g of c.mustMentionOneOf ?? []) {
    if (!g.label || !Array.isArray(g.values) || g.values.length === 0) {
      throw new Error(
        `pickled.yml: task "${t.id}" mustMentionOneOf groups need a label and non-empty values`,
      );
    }
  }
}

/**
 * Build tasks prove success with `verify`, not text checks. They forbid
 * `checks`/`examples` (which score answer text), require a `workspace` + at
 * least one `verify` command, and run only on edit-capable CLI agents (build
 * edits files and runs code; API agents have no repo-edit loop).
 */
function validateBuildTask(
  t: PublicTask,
  agents: Record<string, PublicAgent>,
): void {
  if (t.checks !== undefined) {
    throw new Error(
      `pickled.yml: build task "${t.id}" cannot declare checks; a build task's contract is verify.`,
    );
  }
  if (t.examples !== undefined) {
    throw new Error(
      `pickled.yml: build task "${t.id}" cannot declare examples; examples score answer checks, which build tasks do not use.`,
    );
  }
  if (typeof t.workspace?.path !== "string" || t.workspace.path.length === 0) {
    throw new Error(
      `pickled.yml: build task "${t.id}" needs a non-empty workspace.path (the fixture the agent edits).`,
    );
  }
  if (
    t.workspace.setup !== undefined &&
    (!Array.isArray(t.workspace.setup) ||
      t.workspace.setup.some((c) => typeof c !== "string" || c.length === 0))
  ) {
    throw new Error(
      `pickled.yml: build task "${t.id}" workspace.setup must be a list of non-empty shell command strings.`,
    );
  }
  if (
    !Array.isArray(t.verify) ||
    t.verify.length === 0 ||
    t.verify.some((c) => typeof c !== "string" || c.length === 0)
  ) {
    throw new Error(
      `pickled.yml: build task "${t.id}" needs at least one non-empty verify command.`,
    );
  }
  if (t.trials !== undefined && (!Number.isInteger(t.trials) || t.trials < 1)) {
    throw new Error(
      `pickled.yml: build task "${t.id}" trials must be a positive integer.`,
    );
  }
  for (const name of t.agents) {
    const provider = agents[name]?.provider;
    if (provider && PROVIDERS[provider] !== "cli") {
      throw new Error(
        `pickled.yml: build task "${t.id}" agent "${name}" (${provider}) cannot run build tasks; build requires an edit-capable CLI agent (claude-code, codex-cli).`,
      );
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
 * - tasks -> scenarios with matrix.accessPairs. Answer tasks: checks ->
 *   expected (mustMention->includes, mustNotMention->excludes,
 *   mustMentionOneOf->expected.mustMentionOneOf). Build tasks: kind/workspace/
 *   verify/trials carried as inert metadata (no answer contract).
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
    { access: string; source: string | null; toolset: string }
  > = {};
  for (const [name, access] of Object.entries(pub.access)) {
    if (access.tools === "none") {
      toolsets.none = {};
      pairByAccess[name] = {
        access: name,
        source: access.source,
        toolset: "none",
      };
    } else if (access.tools === "web") {
      toolsets[name] = { webSearch: true, webFetch: true };
      pairByAccess[name] = {
        access: name,
        source: access.source,
        toolset: name,
      };
    } else {
      const mcpServers: Record<string, McpServerConfig> = {};
      for (const [label, server] of Object.entries(access.servers ?? {})) {
        // Public MCP is HTTP-only; the transport is fixed, not user-set.
        const cfg: McpServerConfig = { type: "http", url: server.url };
        if (server.headers) cfg.headers = server.headers;
        mcpServers[label] = cfg;
      }
      toolsets[name] = { mcpServers };
      pairByAccess[name] = {
        access: name,
        source: access.source,
        toolset: name,
      };
    }
  }

  const scenarios: Scenario[] = pub.tasks.map((t) => {
    const matrix = {
      interfaces: t.agents,
      accessPairs: t.access.map((a) => pairByAccess[a]),
    };
    // Build scenario: carry the build metadata; no answer contract. Inert
    // until runCheck routes kind: build to the build runner (later phase).
    if ((t.kind ?? "answer") === "build") {
      const scenario: Scenario = {
        name: t.id,
        prompt: t.prompt,
        kind: "build",
        matrix,
        workspace: t.workspace,
        verify: t.verify,
      };
      if (t.trials !== undefined) scenario.trials = t.trials;
      return scenario;
    }
    const checks = t.checks ?? {};
    const expected: ExpectedChecks = {};
    if (checks.mustMention?.length) expected.includes = checks.mustMention;
    if (checks.mustNotMention?.length)
      expected.excludes = checks.mustNotMention;
    if (checks.mustMentionOneOf?.length)
      expected.mustMentionOneOf = checks.mustMentionOneOf;
    const scenario: Scenario = {
      name: t.id,
      prompt: t.prompt,
      matrix,
      expected,
    };
    if (t.examples) scenario.examples = t.examples;
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
