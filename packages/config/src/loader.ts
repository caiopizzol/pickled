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

  validate(parsed);
  return parsed;
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
      validateDocSourceEntry(id, value);
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
  for (const scenario of config.scenarios) {
    if (!scenario.name || !scenario.prompt) {
      throw new Error("pickled.yml: every scenario needs 'name' and 'prompt'");
    }
    if (!Array.isArray(scenario.requiredSources)) {
      throw new Error(
        `pickled.yml: scenario "${scenario.name}" is missing 'requiredSources' (use [] to allow any citation)`,
      );
    }
    for (const id of scenario.requiredSources) {
      if (!sourceIds.has(id)) {
        throw new Error(
          `pickled.yml: scenario "${scenario.name}" references unknown source "${id}". Declared sources: ${[...sourceIds].join(", ") || "(none)"}`,
        );
      }
    }
    validateTraps(scenario.name, scenario.traps);
    validateCompareSurfaces(scenario.name, scenario.compareSurfaces, sourceIds);
  }

  validateAuditTrapsSuppression(config);
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
