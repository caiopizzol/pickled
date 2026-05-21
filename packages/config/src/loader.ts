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
      if (typeof value !== "string" || value.length === 0) {
        throw new Error(
          `pickled.yml: docs.sources["${id}"] must be a non-empty string (file path or URL)`,
        );
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
