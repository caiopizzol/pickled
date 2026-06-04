import YAML from "yaml";
import { resolvePublicConfig, validatePublicConfig } from "./transform.js";
import type { Config } from "./types.js";

/**
 * Load and resolve pickled.yml into the canonical internal Config. Pipeline:
 * parse -> expand ${ENV} -> validate the public schema -> resolve to the
 * normalized domain. The resolver's output type is the guarantee; there is no
 * separate internal backstop validation (v1 had one because it compiled into a
 * looser model).
 */
export async function loadConfig(dir: string): Promise<Config> {
  const configPath = `${dir}/pickled.yml`;

  const file = Bun.file(configPath);
  if (!(await file.exists())) {
    throw new Error(`pickled.yml not found in ${dir}`);
  }

  let parsed: unknown;
  try {
    parsed = YAML.parse(await file.text());
  } catch (error) {
    throw new Error(`Failed to parse pickled.yml: ${error}`);
  }

  const expanded = expandEnvVars(parsed);
  validatePublicConfig(expanded);
  return resolvePublicConfig(expanded);
}

// Substitute `${VAR}` patterns in any string value with `process.env.VAR`.
// Scoped to UPPER_SNAKE_CASE names so real YAML strings are not rewritten.
// Missing env vars become empty strings so the failure surfaces at the call
// site (e.g. a 401 from an MCP server), not at load time. Bun auto-loads `.env`.
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
