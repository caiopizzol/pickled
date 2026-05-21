import type { CheckConfig } from "./types.js";

/**
 * Narrow a CheckConfig to a single named target.
 *
 * Used by CLI flags like `pickled check --target <name>`. The override is
 * strict: only scenarios that can run against `name` survive. A scenario
 * with no explicit target runs under the (now-narrowed) matrix; a scenario
 * whose explicit `target` matches `name` is kept; a scenario whose explicit
 * target is something else is dropped, because its author said "this
 * scenario is for that other target." Silently rerouting it would violate
 * the brand contract that scenario verdicts mean what the author declared.
 *
 * Validation: `name` must be a configured target key or the "default"
 * sentinel. Throws with a clear message listing available targets otherwise.
 *
 * Returns a new CheckConfig. Does not mutate the input.
 */
export function overrideTarget(config: CheckConfig, name: string): CheckConfig {
  const validNames = new Set([...Object.keys(config.targets ?? {}), "default"]);
  if (!validNames.has(name)) {
    const available = [...validNames].sort().join(", ");
    throw new Error(
      `Unknown target: "${name}". Available targets: ${available}`,
    );
  }
  return {
    ...config,
    matrix: { ...config.matrix, target: [name] },
    scenarios: config.scenarios.filter((s) => !s.target || s.target === name),
  };
}
