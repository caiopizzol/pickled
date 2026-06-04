import type {
  PublicBuild,
  PublicConfig,
  PublicContext,
  PublicQuestion,
  PublicSource,
} from "./public-types.js";
import type {
  Build,
  Command,
  Config,
  Context,
  Fact,
  McpServerConfig,
  Misstatement,
  Question,
  Source,
  Target,
  TargetCategory,
  Verifier,
} from "./types.js";

const PROVIDERS: Record<string, TargetCategory> = {
  openai: "api",
  anthropic: "api",
  "claude-code": "cli",
  "codex-cli": "cli",
};

/** Providers that can edit a workspace and run code (build tasks). */
const EDIT_CAPABLE = new Set(["claude-code", "codex-cli"]);

const ALLOWED_TOP_LEVEL = [
  "schemaVersion",
  "product",
  "sources",
  "agents",
  "contexts",
  "facts",
  "misstatements",
  "questions",
  "builds",
  "thresholds",
];

/** v1 keys that signal an un-migrated config; named so the error can guide. */
const V1_KEYS = new Set(["tasks", "access", "checks", "threshold", "kind"]);

const CODEBASE_HARD_CAP = 4 * 1024 * 1024;

function fail(msg: string): never {
  throw new Error(`pickled.yml: ${msg}`);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asNonEmptyString(v: unknown, what: string): string {
  if (typeof v !== "string" || v.length === 0) {
    fail(`${what} must be a non-empty string`);
  }
  return v;
}

function asStringArray(v: unknown, what: string): string[] {
  if (
    !Array.isArray(v) ||
    v.some((x) => typeof x !== "string" || x.length === 0)
  ) {
    fail(`${what} must be an array of non-empty strings`);
  }
  return v as string[];
}

function asStringRecord(v: unknown, what: string): Record<string, string> {
  if (!isObject(v)) fail(`${what} must be an object of string values`);
  for (const [k, val] of Object.entries(v)) {
    if (typeof val !== "string") fail(`${what}.${k} must be a string`);
  }
  return v as Record<string, string>;
}

function asPositiveInt(v: unknown, what: string): void {
  if (!Number.isInteger(v) || (v as number) < 1) {
    fail(`${what} must be a positive integer`);
  }
}

/** Reject any object key not in the allow-list, so typos fail loudly. */
function rejectUnknown(
  obj: Record<string, unknown>,
  allowed: readonly string[],
  what: string,
): void {
  for (const k of Object.keys(obj)) {
    if (!allowed.includes(k)) fail(`${what} has unknown field "${k}"`);
  }
}

/**
 * Validate the public config in its own vocabulary. Throws on the first
 * violation with a `pickled.yml:` message. After this returns, the value is a
 * well-formed PublicConfig and `resolvePublicConfig` can assume it.
 */
export function validatePublicConfig(
  pub: unknown,
): asserts pub is PublicConfig {
  if (!isObject(pub)) fail("config must be an object");

  if (pub.schemaVersion !== 2) {
    fail(
      "this is the v2 schema. Add `schemaVersion: 2` and migrate from v1: tasks -> questions/builds, access -> contexts, checks -> facts/misstatements, verify -> verifier.",
    );
  }
  for (const key of Object.keys(pub)) {
    if (V1_KEYS.has(key)) {
      fail(
        `"${key}" is a v1 key. v2 uses product/sources/agents/contexts/facts/misstatements/questions/builds/thresholds.`,
      );
    }
    if (!ALLOWED_TOP_LEVEL.includes(key)) {
      fail(`unknown top-level key "${key}".`);
    }
  }

  if (!isObject(pub.product)) fail("'product' is required");
  asNonEmptyString(pub.product.name, "'product.name'");
  asNonEmptyString(pub.product.description, "'product.description'");
  rejectUnknown(pub.product, ["name", "description"], "product");

  const sourceIds = validateSources(pub.sources);
  const agentNames = validateAgents(pub.agents);
  const contextNames = validateContexts(pub.contexts, sourceIds);
  const factIds = validateMatchRegistry(pub.facts, "facts");
  const misstatementIds = validateMatchRegistry(
    pub.misstatements,
    "misstatements",
  );

  const questions = pub.questions;
  const builds = pub.builds;
  if (questions !== undefined && !Array.isArray(questions)) {
    fail("'questions' must be an array");
  }
  if (builds !== undefined && !Array.isArray(builds)) {
    fail("'builds' must be an array");
  }
  const hasQuestions = Array.isArray(questions) && questions.length > 0;
  const hasBuilds = Array.isArray(builds) && builds.length > 0;
  if (!hasQuestions && !hasBuilds) {
    fail("declare at least one non-empty 'questions' or 'builds' array");
  }

  const seenIds = new Set<string>();
  for (const q of questions ?? []) {
    validateQuestion(q, {
      agentNames,
      contextNames,
      factIds,
      misstatementIds,
      seenIds,
    });
  }
  for (const b of builds ?? []) {
    validateBuild(b, {
      agentNames,
      contextNames,
      factIds,
      seenIds,
      agents: (pub.agents ?? {}) as Record<string, { provider?: string }>,
    });
  }

  if (pub.thresholds !== undefined) {
    if (!isObject(pub.thresholds)) fail("'thresholds' must be an object");
    for (const [k, v] of Object.entries(pub.thresholds)) {
      if (k !== "questions" && k !== "builds") {
        fail(`thresholds has unknown key "${k}" (allowed: questions, builds)`);
      }
      if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 100) {
        fail(
          `thresholds.${k} must be an integer between 1 and 100 (omit the key for no gate)`,
        );
      }
    }
  }
}

function validateSources(sources: unknown): Set<string> {
  const ids = new Set<string>();
  if (sources === undefined) return ids;
  if (!isObject(sources)) fail("'sources' must be an object");
  for (const [id, entry] of Object.entries(sources)) {
    ids.add(id);
    if (!isObject(entry)) {
      fail(
        `source "${id}" must be an object with exactly one of url / path / codebase`,
      );
    }
    const kinds = ["url", "path", "codebase"].filter((k) => k in entry);
    if (kinds.length !== 1) {
      fail(
        `source "${id}" must declare exactly one of url / path / codebase (got ${kinds.length})`,
      );
    }
    const kind = kinds[0] as "url" | "path" | "codebase";
    asNonEmptyString(entry[kind], `source "${id}".${kind}`);
    if (kind === "codebase") {
      if (entry.exclude !== undefined) {
        asStringArray(entry.exclude, `source "${id}".exclude`);
      }
      if (entry.maxBytes !== undefined) {
        const n = entry.maxBytes;
        if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) {
          fail(`source "${id}".maxBytes must be a positive number`);
        }
        if (n > CODEBASE_HARD_CAP) {
          fail(`source "${id}".maxBytes (${n}) exceeds the 4 MB hard cap`);
        }
      }
      rejectUnknown(
        entry,
        ["codebase", "exclude", "maxBytes"],
        `source "${id}" (codebase)`,
      );
    } else {
      rejectUnknown(entry, [kind], `source "${id}" (${kind})`);
    }
  }
  return ids;
}

function validateAgents(agents: unknown): Set<string> {
  if (!isObject(agents) || Object.keys(agents).length === 0) {
    fail("at least one agent is required");
  }
  const names = new Set<string>();
  for (const [name, agent] of Object.entries(agents)) {
    names.add(name);
    if (!isObject(agent)) fail(`agent "${name}" must be an object`);
    const provider = agent.provider;
    if (typeof provider !== "string" || !(provider in PROVIDERS)) {
      fail(
        `agent "${name}" needs a provider (one of ${Object.keys(PROVIDERS).join(", ")})`,
      );
    }
    asNonEmptyString(agent.model, `agent "${name}".model`);
    if (
      agent.temperature !== undefined &&
      typeof agent.temperature !== "number"
    ) {
      fail(`agent "${name}".temperature must be a number`);
    }
    if (agent.maxTokens !== undefined) {
      asPositiveInt(agent.maxTokens, `agent "${name}".maxTokens`);
    }
    if (agent.maxTurns !== undefined) {
      asPositiveInt(agent.maxTurns, `agent "${name}".maxTurns`);
      if (provider === "codex-cli") {
        fail(
          `agent "${name}" (codex-cli) does not support maxTurns; remove it`,
        );
      }
      if (PROVIDERS[provider] === "api") {
        fail(
          `agent "${name}" (${provider}) is an API agent; maxTurns does not apply`,
        );
      }
    }
    rejectUnknown(
      agent,
      ["provider", "model", "temperature", "maxTokens", "maxTurns"],
      `agent "${name}"`,
    );
  }
  return names;
}

function validateContexts(
  contexts: unknown,
  sourceIds: Set<string>,
): Set<string> {
  if (!isObject(contexts) || Object.keys(contexts).length === 0) {
    fail("at least one context is required");
  }
  const names = new Set<string>();
  for (const [name, ctx] of Object.entries(contexts)) {
    names.add(name);
    if (!isObject(ctx)) fail(`context "${name}" must be an object`);
    const mode = ctx.mode;
    if (
      mode !== "memory" &&
      mode !== "inject" &&
      mode !== "web" &&
      mode !== "mcp"
    ) {
      fail(`context "${name}".mode must be one of memory | inject | web | mcp`);
    }
    const hasSource = ctx.source !== undefined;
    const hasServers = ctx.servers !== undefined;
    if (hasSource) {
      const sid = asNonEmptyString(ctx.source, `context "${name}".source`);
      if (!sourceIds.has(sid)) {
        fail(`context "${name}" references unknown source "${sid}"`);
      }
    }
    if (mode === "memory" && hasSource) {
      fail(`context "${name}" (memory) cannot declare a source`);
    }
    if (mode === "inject" && !hasSource) {
      fail(`context "${name}" (inject) requires a source`);
    }
    if (mode !== "mcp" && hasServers) {
      fail(`context "${name}" (${mode}) cannot declare servers`);
    }
    if (mode === "mcp") {
      if (!isObject(ctx.servers) || Object.keys(ctx.servers).length === 0) {
        fail(`context "${name}" (mcp) requires a non-empty 'servers' map`);
      }
      for (const [label, server] of Object.entries(ctx.servers)) {
        if (!isObject(server)) {
          fail(`context "${name}" server "${label}" must be an object`);
        }
        const url = server.url;
        if (typeof url !== "string" || !/^https?:\/\//.test(url)) {
          fail(`context "${name}" server "${label}" needs an http(s) 'url'`);
        }
        if (server.headers !== undefined) {
          asStringRecord(
            server.headers,
            `context "${name}" server "${label}".headers`,
          );
        }
        rejectUnknown(
          server,
          ["url", "headers"],
          `context "${name}" server "${label}"`,
        );
      }
      rejectUnknown(
        ctx,
        ["mode", "source", "servers"],
        `context "${name}" (mcp)`,
      );
    } else {
      rejectUnknown(ctx, ["mode", "source"], `context "${name}" (${mode})`);
    }
  }
  return names;
}

function validateMatchRegistry(reg: unknown, what: string): Set<string> {
  const ids = new Set<string>();
  if (reg === undefined) return ids;
  if (!isObject(reg)) fail(`'${what}' must be an object`);
  for (const [id, entry] of Object.entries(reg)) {
    ids.add(id);
    if (!isObject(entry)) fail(`${what} "${id}" must be an object`);
    asNonEmptyString(entry.statement, `${what} "${id}".statement`);
    if (!isObject(entry.match)) fail(`${what} "${id}".match is required`);
    const { allOf, anyOf } = entry.match;
    const hasAll = allOf !== undefined;
    const hasAny = anyOf !== undefined;
    if (!hasAll && !hasAny) {
      fail(`${what} "${id}".match needs at least one of allOf / anyOf`);
    }
    if (hasAll) asStringArray(allOf, `${what} "${id}".match.allOf`);
    if (hasAny) asStringArray(anyOf, `${what} "${id}".match.anyOf`);
    rejectUnknown(entry.match, ["allOf", "anyOf"], `${what} "${id}".match`);
    rejectUnknown(entry, ["statement", "match"], `${what} "${id}"`);
  }
  return ids;
}

interface QuestionRefs {
  agentNames: Set<string>;
  contextNames: Set<string>;
  factIds: Set<string>;
  misstatementIds: Set<string>;
  seenIds: Set<string>;
}

function validateQuestion(q: unknown, refs: QuestionRefs): void {
  if (!isObject(q)) fail("each question must be an object");
  const id = asNonEmptyString(q.id, "question id");
  if (refs.seenIds.has(id)) fail(`duplicate task id "${id}"`);
  refs.seenIds.add(id);
  asNonEmptyString(q.question, `question "${id}".question`);
  refIds(
    asStringArray(q.agents, `question "${id}".agents`),
    refs.agentNames,
    id,
    "agent",
  );
  refIds(
    asStringArray(q.contexts, `question "${id}".contexts`),
    refs.contextNames,
    id,
    "context",
  );

  const expects =
    q.expects === undefined
      ? []
      : asStringArray(q.expects, `question "${id}".expects`);
  const rejects =
    q.rejects === undefined
      ? []
      : asStringArray(q.rejects, `question "${id}".rejects`);
  if (expects.length === 0 && rejects.length === 0) {
    fail(`question "${id}" needs at least one of expects / rejects`);
  }
  refIds(expects, refs.factIds, id, "fact (expects)");
  refIds(rejects, refs.misstatementIds, id, "misstatement (rejects)");

  if (q.examples !== undefined) validateExamples(q.examples, id);
  if (rejects.length > 0) {
    const ex = isObject(q.examples) ? q.examples : undefined;
    const pass = ex && Array.isArray(ex.pass) ? ex.pass : [];
    const failArr = ex && Array.isArray(ex.fail) ? ex.fail : [];
    if (pass.length === 0 || failArr.length === 0) {
      fail(
        `question "${id}" declares rejects, so it needs non-empty examples.pass AND examples.fail (the pass example proves the veto does not fire on a correct answer).`,
      );
    }
  }

  rejectUnknown(
    q,
    ["id", "question", "agents", "contexts", "expects", "rejects", "examples"],
    `question "${id}"`,
  );
}

function validateExamples(examples: unknown, id: string): void {
  if (!isObject(examples)) fail(`question "${id}".examples must be an object`);
  for (const key of ["pass", "fail"] as const) {
    if (examples[key] !== undefined) {
      asStringArray(examples[key], `question "${id}".examples.${key}`);
    }
  }
  rejectUnknown(examples, ["pass", "fail"], `question "${id}".examples`);
}

interface BuildRefs {
  agentNames: Set<string>;
  contextNames: Set<string>;
  factIds: Set<string>;
  seenIds: Set<string>;
  agents: Record<string, { provider?: string }>;
}

function validateBuild(b: unknown, refs: BuildRefs): void {
  if (!isObject(b)) fail("each build must be an object");
  const id = asNonEmptyString(b.id, "build id");
  if (refs.seenIds.has(id)) fail(`duplicate task id "${id}"`);
  refs.seenIds.add(id);
  asNonEmptyString(b.goal, `build "${id}".goal`);
  const agents = asStringArray(b.agents, `build "${id}".agents`);
  refIds(agents, refs.agentNames, id, "agent");
  for (const a of agents) {
    const provider = refs.agents[a]?.provider;
    if (provider && !EDIT_CAPABLE.has(provider)) {
      fail(
        `build "${id}" agent "${a}" (${provider}) cannot run builds; use an edit-capable CLI agent (claude-code, codex-cli)`,
      );
    }
  }
  refIds(
    asStringArray(b.contexts, `build "${id}".contexts`),
    refs.contextNames,
    id,
    "context",
  );
  if (b.requires !== undefined) {
    refIds(
      asStringArray(b.requires, `build "${id}".requires`),
      refs.factIds,
      id,
      "fact (requires)",
    );
  }
  if (b.trials !== undefined) {
    asPositiveInt(b.trials, `build "${id}".trials`);
  }
  if (
    !isObject(b.workspace) ||
    typeof b.workspace.path !== "string" ||
    !b.workspace.path
  ) {
    fail(`build "${id}" needs a non-empty workspace.path`);
  }
  if (b.workspace.setup !== undefined) {
    asStringArray(b.workspace.setup, `build "${id}".workspace.setup`);
  }
  rejectUnknown(b.workspace, ["path", "setup"], `build "${id}".workspace`);
  validateVerifier(b.verifier, id);
  if (b.referenceSolution !== undefined) {
    if (!isObject(b.referenceSolution)) {
      fail(`build "${id}".referenceSolution must be an object`);
    }
    asNonEmptyString(
      b.referenceSolution.patch,
      `build "${id}".referenceSolution.patch`,
    );
    rejectUnknown(
      b.referenceSolution,
      ["patch"],
      `build "${id}".referenceSolution`,
    );
  }
  rejectUnknown(
    b,
    [
      "id",
      "goal",
      "agents",
      "contexts",
      "trials",
      "requires",
      "workspace",
      "verifier",
      "referenceSolution",
    ],
    `build "${id}"`,
  );
}

function validateVerifier(verifier: unknown, id: string): void {
  if (!isObject(verifier)) fail(`build "${id}" needs a 'verifier'`);
  if (!Array.isArray(verifier.failToPass) || verifier.failToPass.length === 0) {
    fail(`build "${id}".verifier.failToPass needs at least one command`);
  }
  validateCommands(verifier.failToPass, id, "failToPass");
  if (verifier.passToPass !== undefined) {
    if (!Array.isArray(verifier.passToPass)) {
      fail(`build "${id}".verifier.passToPass must be an array`);
    }
    validateCommands(verifier.passToPass, id, "passToPass");
  }
  rejectUnknown(
    verifier,
    ["failToPass", "passToPass"],
    `build "${id}".verifier`,
  );
}

function validateCommands(cmds: unknown[], id: string, group: string): void {
  for (const c of cmds) {
    if (!isObject(c)) {
      fail(`build "${id}".verifier.${group} entries must be objects`);
    }
    asNonEmptyString(c.run, `build "${id}".verifier.${group}[].run`);
    if (c.name !== undefined && (typeof c.name !== "string" || !c.name)) {
      fail(
        `build "${id}".verifier.${group}[].name must be a non-empty string when set`,
      );
    }
    rejectUnknown(c, ["name", "run"], `build "${id}".verifier.${group}[]`);
  }
}

function refIds(
  ids: string[],
  known: Set<string>,
  taskId: string,
  label: string,
): void {
  for (const id of ids) {
    if (!known.has(id)) {
      fail(`task "${taskId}" references unknown ${label} "${id}"`);
    }
  }
}

/**
 * Resolve a validated public config into the canonical internal Config. Applies
 * every default so core consumes a fully-normalized model.
 */
export function resolvePublicConfig(pub: PublicConfig): Config {
  return {
    product: {
      name: pub.product.name,
      description: pub.product.description,
    },
    sources: mapValues(pub.sources ?? {}, resolveSource),
    agents: mapValues(pub.agents, resolveAgent),
    contexts: mapValues(pub.contexts, resolveContext),
    facts: mapValues(
      pub.facts ?? {},
      (f): Fact => ({ statement: f.statement, match: f.match }),
    ),
    misstatements: mapValues(
      pub.misstatements ?? {},
      (m): Misstatement => ({ statement: m.statement, match: m.match }),
    ),
    questions: (pub.questions ?? []).map(resolveQuestion),
    builds: (pub.builds ?? []).map(resolveBuild),
    thresholds: {
      questions: pub.thresholds?.questions,
      builds: pub.thresholds?.builds,
    },
  };
}

function mapValues<V, R>(
  obj: Record<string, V>,
  fn: (v: V) => R,
): Record<string, R> {
  const out: Record<string, R> = {};
  for (const [k, v] of Object.entries(obj)) out[k] = fn(v);
  return out;
}

function resolveSource(s: PublicSource): Source {
  if ("url" in s) return { kind: "url", url: s.url };
  if ("codebase" in s) {
    return {
      kind: "codebase",
      path: s.codebase,
      exclude: s.exclude,
      maxBytes: s.maxBytes,
    };
  }
  return { kind: "file", path: s.path };
}

function resolveAgent(a: PublicConfig["agents"][string]): Target {
  const target: Target = {
    category: PROVIDERS[a.provider] ?? "api",
    provider: a.provider,
    model: a.model,
  };
  if (a.temperature !== undefined) target.temperature = a.temperature;
  if (a.maxTokens !== undefined) target.maxTokens = a.maxTokens;
  if (a.maxTurns !== undefined) target.maxTurns = a.maxTurns;
  return target;
}

function resolveContext(c: PublicContext): Context {
  switch (c.mode) {
    case "memory":
      return { mode: "memory" };
    case "inject":
      return { mode: "inject", source: c.source };
    case "web":
      return c.source !== undefined
        ? { mode: "web", source: c.source }
        : { mode: "web" };
    case "mcp": {
      const servers: Record<string, McpServerConfig> = {};
      for (const [label, server] of Object.entries(c.servers)) {
        servers[label] = {
          type: "http",
          url: server.url,
          headers: server.headers,
        };
      }
      return c.source !== undefined
        ? { mode: "mcp", source: c.source, servers }
        : { mode: "mcp", servers };
    }
  }
}

function resolveQuestion(q: PublicQuestion): Question {
  const question: Question = {
    id: q.id,
    question: q.question,
    agents: q.agents,
    contexts: q.contexts,
    expects: q.expects ?? [],
    rejects: q.rejects ?? [],
  };
  if (q.examples) {
    question.examples = {
      pass: q.examples.pass ?? [],
      fail: q.examples.fail ?? [],
    };
  }
  return question;
}

function resolveBuild(b: PublicBuild): Build {
  const verifier: Verifier = {
    failToPass: b.verifier.failToPass.map(resolveCommand),
    passToPass: (b.verifier.passToPass ?? []).map(resolveCommand),
  };
  const build: Build = {
    id: b.id,
    goal: b.goal,
    agents: b.agents,
    contexts: b.contexts,
    trials: b.trials ?? 1,
    requires: b.requires ?? [],
    workspace: { path: b.workspace.path, setup: b.workspace.setup ?? [] },
    verifier,
  };
  if (b.referenceSolution) {
    build.referenceSolution = { patch: b.referenceSolution.patch };
  }
  return build;
}

function resolveCommand(c: { name?: string; run: string }): Command {
  return { name: c.name ?? c.run, run: c.run };
}
