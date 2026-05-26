import YAML from "yaml";
import type { CheckConfig, Trap } from "./types.js";

export async function loadConfig(dir: string): Promise<CheckConfig> {
  const configPath = `${dir}/pickled.yml`;

  const file = Bun.file(configPath);
  if (!(await file.exists())) {
    throw new Error(`pickled.yml not found in ${dir}`);
  }

  let parsed: CheckConfig;
  try {
    const content = await file.text();
    parsed = YAML.parse(content) as CheckConfig;
  } catch (error) {
    throw new Error(`Failed to parse pickled.yml: ${error}`);
  }

  parsed = expandEnvVars(parsed) as CheckConfig;

  validate(parsed);
  return parsed;
}

// Substitute `${VAR}` patterns in any string value with `process.env.VAR`.
// Scoped to UPPER_SNAKE_CASE names so we don't accidentally rewrite real
// YAML strings (e.g., template literals, regex placeholders). Missing env
// vars become empty strings so the failure surfaces at the actual call
// site (e.g., a 401 from an MCP server) rather than at load time, which
// would block unrelated runs whenever a single optional secret is unset.
// Bun auto-loads `.env` into process.env, so this works with the conventional
// dotfile.
const ENV_VAR_RE = /\$\{([A-Z_][A-Z0-9_]*)\}/g;
export function expandEnvVars(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replace(ENV_VAR_RE, (_match, name) => process.env[name] ?? "");
  }
  if (Array.isArray(value)) return value.map(expandEnvVars);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = expandEnvVars(v);
    }
    return out;
  }
  return value;
}

function validate(config: CheckConfig): void {
  if (!config.tool?.name) {
    throw new Error("pickled.yml: 'tool.name' is required");
  }
  if (!Array.isArray(config.scenarios) || config.scenarios.length === 0) {
    throw new Error("pickled.yml: 'scenarios' must be a non-empty array");
  }

  if (config.docs?.sources) {
    for (const [id, value] of Object.entries(config.docs.sources)) {
      if (id === "none") {
        // "none" is the reserved no-context sentinel for matrix.sources;
        // registering a real source under that ID would silently shadow
        // the sentinel and produce unexpected cell behavior.
        throw new Error(
          `pickled.yml: docs.sources cannot use the reserved id "none". That name represents the no-context matrix cell (model prior with toolset:none, or open discovery with toolset:web). Rename this source.`,
        );
      }
      validateDocSourceEntry(id, value);
    }
  }

  if (config.toolsets) {
    if (typeof config.toolsets !== "object" || Array.isArray(config.toolsets)) {
      throw new Error(
        `pickled.yml: 'toolsets' must be an object mapping name to configuration`,
      );
    }
    for (const [name, ts] of Object.entries(config.toolsets)) {
      if (typeof ts !== "object" || ts === null || Array.isArray(ts)) {
        throw new Error(`pickled.yml: toolsets["${name}"] must be an object`);
      }
    }
  }

  if (config.targets) {
    for (const [name, target] of Object.entries(config.targets)) {
      if ((target as Record<string, unknown>).systemPrompt !== undefined) {
        throw new Error(
          `pickled.yml: target "${name}" sets 'systemPrompt', which bypasses the citation contract. Remove it; custom prompts are not supported in citation mode.`,
        );
      }
      if (target.provider === "codex-cli") {
        if (!target.model) {
          throw new Error(
            `pickled.yml: target "${name}" (codex-cli) requires an explicit 'model' field. Codex's default model can change without notice; pin it for reproducible evals.`,
          );
        }
        if (target.maxTurns !== undefined) {
          throw new Error(
            `pickled.yml: target "${name}" (codex-cli) sets 'maxTurns', but the codex CLI does not support a turn cap. Remove the field.`,
          );
        }
      }
      if (target.category === "api") {
        if (!target.model) {
          throw new Error(
            `pickled.yml: target "${name}" (api/${target.provider}) requires an explicit 'model' field. Pickled does not substitute a default; reproducible evals depend on pinning the model.`,
          );
        }
        const cliOnlyFields: Array<keyof Target> = [
          "allowedTools",
          "disallowedTools",
          "mcpServers",
          "permissionMode",
          "maxTurns",
          "maxThinkingTokens",
          "maxBudgetUsd",
        ];
        for (const field of cliOnlyFields) {
          if (target[field] !== undefined) {
            throw new Error(
              `pickled.yml: target "${name}" (api/${target.provider}) sets '${field}', which only applies to CLI/Agent SDK targets. Remove the field; API targets accept only model/temperature/maxTokens/threshold.`,
            );
          }
        }
        if (target.workspaceContext !== undefined) {
          throw new Error(
            `pickled.yml: target "${name}" (api/${target.provider}) sets 'workspaceContext', which only applies to IDE targets. Remove the field.`,
          );
        }
      }
    }
  }

  const sourceIds = new Set(Object.keys(config.docs?.sources ?? {}));
  const targetNames = new Set(Object.keys(config.targets ?? {}));
  const contextNames = new Set(Object.keys(config.contexts ?? {}));

  validateTopLevelMatrixRefs(config.matrix, targetNames, contextNames);

  for (const scenario of config.scenarios) {
    if (!scenario.name || !scenario.prompt) {
      throw new Error("pickled.yml: every scenario needs 'name' and 'prompt'");
    }
    if (scenario.requiredSources !== undefined) {
      if (!Array.isArray(scenario.requiredSources)) {
        throw new Error(
          `pickled.yml: scenario "${scenario.name}" has non-array 'requiredSources'. Omit the field to skip citation scoring, or set [] for "any cited source counts".`,
        );
      }
      for (const id of scenario.requiredSources) {
        if (!sourceIds.has(id)) {
          throw new Error(
            `pickled.yml: scenario "${scenario.name}" references unknown source "${id}". Declared sources: ${[...sourceIds].join(", ") || "(none)"}`,
          );
        }
      }
    }
    validateScenarioTargetRef(scenario.name, scenario.target, targetNames);
    validateScenarioContextRef(scenario.name, scenario.context, contextNames);
    validateTraps(scenario.name, scenario.traps);
    validateCompareSurfaces(scenario.name, scenario.compareSurfaces, sourceIds);
    validateScenarioMatrix(
      scenario.name,
      scenario.matrix,
      sourceIds,
      targetNames,
      new Set(Object.keys(config.toolsets ?? { none: {} })),
    );
    validateExpected(scenario.name, scenario.expected);
    validateVerifiers(scenario.name, scenario.verifiers, sourceIds);
    validateActionableContract(scenario);
  }

  validateAuditTrapsSuppression(config);
}

const DEFAULT_REF = "default";

function validateScenarioTargetRef(
  scenarioName: string,
  ref: string | undefined,
  targetNames: Set<string>,
): void {
  if (ref === undefined || ref === DEFAULT_REF) return;
  if (targetNames.has(ref)) return;
  const declared = [...targetNames].join(", ") || "(none)";
  throw new Error(
    `pickled.yml: scenario "${scenarioName}" references unknown target "${ref}". Declared targets: ${declared}. Use "default" to fall back to the built-in Claude Code target.`,
  );
}

function validateScenarioContextRef(
  scenarioName: string,
  ref: string | undefined,
  contextNames: Set<string>,
): void {
  if (ref === undefined || ref === DEFAULT_REF) return;
  if (contextNames.has(ref)) return;
  const declared = [...contextNames].join(", ") || "(none)";
  throw new Error(
    `pickled.yml: scenario "${scenarioName}" references unknown context "${ref}". Declared contexts: ${declared}.`,
  );
}

function validateTopLevelMatrixRefs(
  matrix: { target?: unknown; context?: unknown } | undefined,
  targetNames: Set<string>,
  contextNames: Set<string>,
): void {
  if (matrix === undefined) return;
  if (matrix.target !== undefined) {
    if (!Array.isArray(matrix.target)) {
      throw new Error(
        `pickled.yml: matrix.target must be an array of target names (got ${typeof matrix.target}).`,
      );
    }
    for (const ref of matrix.target) {
      if (typeof ref !== "string") {
        throw new Error(`pickled.yml: matrix.target entries must be strings`);
      }
      if (ref === DEFAULT_REF || targetNames.has(ref)) continue;
      const declared = [...targetNames].join(", ") || "(none)";
      throw new Error(
        `pickled.yml: matrix.target references unknown target "${ref}". Declared targets: ${declared}. Use "default" to fall back to the built-in Claude Code target.`,
      );
    }
  }
  if (matrix.context !== undefined) {
    if (!Array.isArray(matrix.context)) {
      throw new Error(
        `pickled.yml: matrix.context must be an array of context names (got ${typeof matrix.context}).`,
      );
    }
    for (const ref of matrix.context) {
      if (typeof ref !== "string") {
        throw new Error(`pickled.yml: matrix.context entries must be strings`);
      }
      if (ref === DEFAULT_REF || contextNames.has(ref)) continue;
      const declared = [...contextNames].join(", ") || "(none)";
      throw new Error(
        `pickled.yml: matrix.context references unknown context "${ref}". Declared contexts: ${declared}.`,
      );
    }
  }
}

/**
 * Cross-source check for list-form audit.traps suppression. Enforces global
 * trap-id uniqueness (across all scenarios) and validates that every listed
 * suppression id references a real declared trap. Only runs if at least one
 * source uses the list form; configs that only use boolean forms keep the
 * existing per-scenario uniqueness rule for backward compatibility.
 */
function validateAuditTrapsSuppression(config: CheckConfig): void {
  if (!config.docs?.sources) return;
  const suppressors: Array<{ id: string; list: string[] }> = [];
  for (const [sourceId, value] of Object.entries(config.docs.sources)) {
    if (typeof value === "string") continue;
    const traps = value.audit?.traps;
    if (Array.isArray(traps)) {
      suppressors.push({ id: sourceId, list: traps });
    }
  }
  if (suppressors.length === 0) return;

  const declared = new Map<string, string>();
  for (const scenario of config.scenarios) {
    for (const trap of scenario.traps ?? []) {
      const prior = declared.get(trap.id);
      if (prior !== undefined) {
        throw new Error(
          `pickled.yml: trap id "${trap.id}" is declared in both scenario "${prior}" and scenario "${scenario.name}". Globally unique trap ids are required when any source uses list-form audit.traps suppression. Rename one of the traps.`,
        );
      }
      declared.set(trap.id, scenario.name);
    }
  }

  for (const { id: sourceId, list } of suppressors) {
    for (const trapId of list) {
      if (!declared.has(trapId)) {
        const known = [...declared.keys()].join(", ") || "(none)";
        throw new Error(
          `pickled.yml: docs.sources["${sourceId}"].audit.traps lists unknown trap id "${trapId}". Declared trap ids: ${known}`,
        );
      }
    }
  }
}

function validateScenarioMatrix(
  scenarioName: string,
  matrix:
    | { interfaces?: string[]; sources?: string[]; toolsets?: string[] }
    | undefined,
  sourceIds: Set<string>,
  targetNames: Set<string>,
  toolsetNames: Set<string>,
): void {
  if (matrix === undefined) return;
  if (typeof matrix !== "object" || Array.isArray(matrix)) {
    throw new Error(
      `pickled.yml: scenario "${scenarioName}" matrix must be an object with optional interfaces/sources/toolsets arrays`,
    );
  }
  const checkArray = (
    field: "interfaces" | "sources" | "toolsets",
    knownNames: Set<string>,
    label: string,
  ): void => {
    const values = matrix[field];
    if (values === undefined) return;
    if (!Array.isArray(values)) {
      throw new Error(
        `pickled.yml: scenario "${scenarioName}" matrix.${field} must be an array of ${label} names`,
      );
    }
    if (values.length === 0) {
      throw new Error(
        `pickled.yml: scenario "${scenarioName}" matrix.${field} cannot be empty (omit the field to use defaults)`,
      );
    }
    for (const name of values) {
      if (typeof name !== "string") {
        throw new Error(
          `pickled.yml: scenario "${scenarioName}" matrix.${field} entries must be strings`,
        );
      }
      if (!knownNames.has(name)) {
        throw new Error(
          `pickled.yml: scenario "${scenarioName}" matrix.${field} references unknown ${label} "${name}". Declared: ${[...knownNames].join(", ") || "(none)"}`,
        );
      }
    }
  };
  checkArray("interfaces", targetNames, "target");
  // matrix.sources also accepts the reserved sentinel "none", which is
  // not a registered source: it represents the "no context" cell
  // (model prior with toolset:none, or open discovery with toolset:web).
  // See packages/core/src/check.ts for the runtime semantics.
  checkArray("sources", new Set([...sourceIds, "none"]), "source");
  checkArray("toolsets", toolsetNames, "toolset");
}

type ExpectedField =
  | "includes"
  | "excludes"
  | "symbols"
  | "paths"
  | "options"
  | "constraints";

const EXPECTED_FIELDS: readonly ExpectedField[] = [
  "includes",
  "excludes",
  "symbols",
  "paths",
  "options",
  "constraints",
];

function validateExpected(
  scenarioName: string,
  expected: Partial<Record<ExpectedField, unknown>> | undefined,
): void {
  if (expected === undefined) return;
  if (typeof expected !== "object" || Array.isArray(expected)) {
    throw new Error(
      `pickled.yml: scenario "${scenarioName}" expected must be an object with optional ${EXPECTED_FIELDS.join("/")} arrays`,
    );
  }
  const checkStrings = (field: ExpectedField): void => {
    const arr = expected[field];
    if (arr === undefined) return;
    if (!Array.isArray(arr)) {
      throw new Error(
        `pickled.yml: scenario "${scenarioName}" expected.${field} must be an array of strings`,
      );
    }
    if (arr.length === 0) {
      throw new Error(
        `pickled.yml: scenario "${scenarioName}" expected.${field} cannot be empty (omit the field instead)`,
      );
    }
    for (let i = 0; i < arr.length; i++) {
      if (typeof arr[i] !== "string" || (arr[i] as string).length === 0) {
        throw new Error(
          `pickled.yml: scenario "${scenarioName}" expected.${field}[${i}] must be a non-empty string`,
        );
      }
    }
  };
  for (const field of EXPECTED_FIELDS) {
    checkStrings(field);
  }
}

function validateVerifiers(
  scenarioName: string,
  verifiers: { sources?: unknown } | undefined,
  sourceIds: Set<string>,
): void {
  if (verifiers === undefined) return;
  if (typeof verifiers !== "object" || Array.isArray(verifiers)) {
    throw new Error(
      `pickled.yml: scenario "${scenarioName}" verifiers must be an object`,
    );
  }
  const sources = verifiers.sources;
  if (sources === undefined) return;
  if (!Array.isArray(sources)) {
    throw new Error(
      `pickled.yml: scenario "${scenarioName}" verifiers.sources must be an array of source IDs`,
    );
  }
  for (const id of sources) {
    if (typeof id !== "string") {
      throw new Error(
        `pickled.yml: scenario "${scenarioName}" verifiers.sources entries must be strings`,
      );
    }
    if (!sourceIds.has(id)) {
      throw new Error(
        `pickled.yml: scenario "${scenarioName}" verifiers.sources references unknown source "${id}"`,
      );
    }
  }
}

function validateActionableContract(scenario: {
  name: string;
  requiredSources?: string[];
  expected?: {
    includes?: string[];
    excludes?: string[];
    symbols?: string[];
    paths?: string[];
    options?: string[];
    constraints?: string[];
  };
  traps?: Trap[];
  compareSurfaces?: string[][];
  matrix?: { interfaces?: string[]; sources?: string[]; toolsets?: string[] };
}): void {
  const hasCitation = scenario.requiredSources !== undefined;
  // Any non-empty expected group counts as an actionable contract. The
  // grouped keys (symbols/paths/options/constraints) score with the same
  // matcher as includes; gating on includes/excludes only would silently
  // reject scenarios that use ONLY the new grouped keys.
  const expectedFields = [
    "includes",
    "excludes",
    "symbols",
    "paths",
    "options",
    "constraints",
  ] as const;
  const hasExpected =
    scenario.expected !== undefined &&
    expectedFields.some((field) => {
      const arr = scenario.expected?.[field];
      return arr !== undefined && arr.length > 0;
    });
  const hasTraps = scenario.traps !== undefined && scenario.traps.length > 0;
  if (!hasCitation && !hasExpected && !hasTraps) {
    throw new Error(
      `pickled.yml: scenario "${scenario.name}" must declare at least one of requiredSources, expected checks (includes/excludes/symbols/paths/options/constraints), or traps. A scenario with nothing to check has no verdict.`,
    );
  }
  // Non-none cells skip the citation contract (source is not injected; the
  // agent uses tools to discover the answer). So requiredSources alone is
  // not actionable for those cells, the verdict would default to YES with
  // no real evidence beyond tool-use provenance. Require expected or traps
  // when the matrix declares any non-none toolset.
  const nonNoneToolsets = (scenario.matrix?.toolsets ?? []).filter(
    (t) => t !== "none",
  );
  if (nonNoneToolsets.length > 0 && !hasExpected && !hasTraps) {
    throw new Error(
      `pickled.yml: scenario "${scenario.name}" declares non-none toolsets [${nonNoneToolsets.join(", ")}] but has no expected checks or traps. Non-none cells skip the citation contract because the source is not injected, so requiredSources alone leaves them with no actionable answer contract. Add expected (any of includes/excludes/symbols/paths/options/constraints) or traps, or restrict matrix.toolsets to ["none"].`,
    );
  }
}

function validateCompareSurfaces(
  scenarioName: string,
  surfaces: string[][] | undefined,
  sourceIds: Set<string>,
): void {
  if (surfaces === undefined) return;
  if (!Array.isArray(surfaces)) {
    throw new Error(
      `pickled.yml: scenario "${scenarioName}" compareSurfaces must be an array of source-id lists`,
    );
  }
  if (surfaces.length === 0) {
    throw new Error(
      `pickled.yml: scenario "${scenarioName}" compareSurfaces cannot be empty (use a non-empty list of surfaces, or remove the field)`,
    );
  }
  for (let i = 0; i < surfaces.length; i++) {
    const surface = surfaces[i];
    if (!Array.isArray(surface)) {
      throw new Error(
        `pickled.yml: scenario "${scenarioName}" compareSurfaces[${i}] must be an array of source ids`,
      );
    }
    if (surface.length === 0) {
      throw new Error(
        `pickled.yml: scenario "${scenarioName}" compareSurfaces[${i}] must be a non-empty list of source ids`,
      );
    }
    for (const id of surface) {
      if (typeof id !== "string") {
        throw new Error(
          `pickled.yml: scenario "${scenarioName}" compareSurfaces[${i}] entries must be string source ids`,
        );
      }
      if (!sourceIds.has(id)) {
        throw new Error(
          `pickled.yml: scenario "${scenarioName}" compareSurfaces[${i}] references unknown source "${id}". Declared sources: ${[...sourceIds].join(", ") || "(none)"}`,
        );
      }
    }
  }
}

function validateDocSourceEntry(id: string, value: unknown): void {
  if (typeof value === "string") {
    if (value.length === 0) {
      throw new Error(
        `pickled.yml: docs.sources["${id}"] string form must be a non-empty file path or URL`,
      );
    }
    return;
  }
  if (!value || typeof value !== "object") {
    throw new Error(
      `pickled.yml: docs.sources["${id}"] must be a string (path/URL) or an object with a 'path' field`,
    );
  }
  const entry = value as Record<string, unknown>;
  if (typeof entry.path !== "string" || entry.path.length === 0) {
    throw new Error(
      `pickled.yml: docs.sources["${id}"] object form requires a non-empty 'path' field`,
    );
  }
  if (entry.audit !== undefined) {
    if (typeof entry.audit !== "object" || entry.audit === null) {
      throw new Error(
        `pickled.yml: docs.sources["${id}"].audit must be an object`,
      );
    }
    const audit = entry.audit as Record<string, unknown>;
    if (audit.traps !== undefined) {
      const traps = audit.traps;
      if (typeof traps === "boolean") {
        // boolean form is always valid
      } else if (Array.isArray(traps)) {
        if (traps.length === 0) {
          throw new Error(
            `pickled.yml: docs.sources["${id}"].audit.traps cannot be an empty array; use true (scan all) or false (skip all) instead`,
          );
        }
        for (let i = 0; i < traps.length; i++) {
          if (typeof traps[i] !== "string") {
            throw new Error(
              `pickled.yml: docs.sources["${id}"].audit.traps[${i}] must be a string trap id`,
            );
          }
        }
      } else {
        throw new Error(
          `pickled.yml: docs.sources["${id}"].audit.traps must be a boolean or an array of trap ids`,
        );
      }
    }
    for (const key of Object.keys(audit)) {
      if (key !== "traps") {
        throw new Error(
          `pickled.yml: docs.sources["${id}"].audit has unknown field "${key}"`,
        );
      }
    }
  }
  if (entry.type !== undefined) {
    if (
      entry.type !== "file" &&
      entry.type !== "url" &&
      entry.type !== "codebase"
    ) {
      throw new Error(
        `pickled.yml: docs.sources["${id}"].type must be "file", "url", or "codebase"`,
      );
    }
  }
  if (entry.type === "codebase") {
    if (
      typeof entry.path === "string" &&
      entry.path.split("/").includes("..")
    ) {
      throw new Error(
        `pickled.yml: docs.sources["${id}"].path must not contain ".." segments. Codebase loader stays within the project root.`,
      );
    }
    if (entry.exclude !== undefined) {
      if (!Array.isArray(entry.exclude)) {
        throw new Error(
          `pickled.yml: docs.sources["${id}"].exclude must be an array of glob patterns`,
        );
      }
      for (let i = 0; i < entry.exclude.length; i++) {
        if (typeof entry.exclude[i] !== "string") {
          throw new Error(
            `pickled.yml: docs.sources["${id}"].exclude[${i}] must be a string glob pattern`,
          );
        }
      }
    }
    if (entry.maxBytes !== undefined) {
      if (
        typeof entry.maxBytes !== "number" ||
        !Number.isFinite(entry.maxBytes) ||
        entry.maxBytes <= 0
      ) {
        throw new Error(
          `pickled.yml: docs.sources["${id}"].maxBytes must be a positive number of bytes`,
        );
      }
      const HARD_CAP = 4 * 1024 * 1024;
      if (entry.maxBytes > HARD_CAP) {
        throw new Error(
          `pickled.yml: docs.sources["${id}"].maxBytes (${entry.maxBytes}) exceeds the 4 MB hard ceiling. Tighten the glob to fit; the cap protects the agent request size.`,
        );
      }
    }
  } else {
    // exclude and maxBytes are codebase-only
    if (entry.exclude !== undefined) {
      throw new Error(
        `pickled.yml: docs.sources["${id}"].exclude only applies to type: codebase sources`,
      );
    }
    if (entry.maxBytes !== undefined) {
      throw new Error(
        `pickled.yml: docs.sources["${id}"].maxBytes only applies to type: codebase sources`,
      );
    }
  }
  for (const key of Object.keys(entry)) {
    if (
      key !== "path" &&
      key !== "audit" &&
      key !== "type" &&
      key !== "exclude" &&
      key !== "maxBytes"
    ) {
      throw new Error(
        `pickled.yml: docs.sources["${id}"] has unknown field "${key}"`,
      );
    }
  }
}

const FORBIDDEN_FLAGS = new Set(["g", "y"]);
const ALLOWED_FLAGS = new Set(["i", "m", "s", "u", "v"]);

function validateTraps(scenarioName: string, traps: Trap[] | undefined): void {
  if (traps === undefined) return;
  if (!Array.isArray(traps)) {
    throw new Error(
      `pickled.yml: scenario "${scenarioName}" has non-array 'traps'`,
    );
  }
  const seenIds = new Set<string>();
  for (const trap of traps) {
    if (!trap.id || typeof trap.id !== "string") {
      throw new Error(
        `pickled.yml: scenario "${scenarioName}" has a trap missing 'id'`,
      );
    }
    if (seenIds.has(trap.id)) {
      throw new Error(
        `pickled.yml: scenario "${scenarioName}" has duplicate trap id "${trap.id}"`,
      );
    }
    seenIds.add(trap.id);
    if (!trap.reason || typeof trap.reason !== "string") {
      throw new Error(
        `pickled.yml: scenario "${scenarioName}" trap "${trap.id}" requires non-empty 'reason'`,
      );
    }
    if (
      trap.auditSeverity !== undefined &&
      trap.auditSeverity !== "warning" &&
      trap.auditSeverity !== "error"
    ) {
      throw new Error(
        `pickled.yml: scenario "${scenarioName}" trap "${trap.id}" auditSeverity must be "warning" or "error"`,
      );
    }
    const hasMatch = typeof trap.match === "string";
    const hasPattern = typeof trap.pattern === "string";
    if (hasMatch === hasPattern) {
      throw new Error(
        `pickled.yml: scenario "${scenarioName}" trap "${trap.id}" must set exactly one of 'match' or 'pattern'`,
      );
    }
    if (hasMatch) {
      if (trap.match === "") {
        throw new Error(
          `pickled.yml: scenario "${scenarioName}" trap "${trap.id}" has empty 'match'`,
        );
      }
      if (trap.flags !== undefined) {
        throw new Error(
          `pickled.yml: scenario "${scenarioName}" trap "${trap.id}" sets 'flags' without 'pattern'`,
        );
      }
    } else {
      const pattern = trap.pattern;
      if (typeof pattern !== "string") {
        throw new Error(
          `pickled.yml: scenario "${scenarioName}" trap "${trap.id}" must set 'pattern'`,
        );
      }
      if (pattern === "") {
        throw new Error(
          `pickled.yml: scenario "${scenarioName}" trap "${trap.id}" has empty 'pattern'`,
        );
      }
      if (trap.flags !== undefined) {
        if (typeof trap.flags !== "string") {
          throw new Error(
            `pickled.yml: scenario "${scenarioName}" trap "${trap.id}" has non-string 'flags'`,
          );
        }
        for (const ch of trap.flags) {
          if (FORBIDDEN_FLAGS.has(ch)) {
            throw new Error(
              `pickled.yml: scenario "${scenarioName}" trap "${trap.id}" uses forbidden regex flag "${ch}" (g and y are not allowed)`,
            );
          }
          if (!ALLOWED_FLAGS.has(ch)) {
            throw new Error(
              `pickled.yml: scenario "${scenarioName}" trap "${trap.id}" uses unsupported regex flag "${ch}"`,
            );
          }
        }
      }
      try {
        new RegExp(pattern, trap.flags ?? "");
      } catch (err) {
        throw new Error(
          `pickled.yml: scenario "${scenarioName}" trap "${trap.id}" has invalid regex pattern: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
  }
}
