import path from "node:path";
import type { Config } from "@pickled-dev/config";
import { formatBuildProof, loadConfig, proveBuilds } from "@pickled-dev/core";
import chalk from "chalk";
import { type CheckOptions, runTasks } from "./check.js";

/**
 * `pickled build`: run the build tasks. The agent edits a fresh workspace per
 * trial and the cell result is k/n by context. Shares cell planning, sampling,
 * --max-cells, and --plan with `pickled check` via runTasks. With --verify-only
 * it proves the harness (preflight + reference) and never runs an agent.
 */
export async function build(
  targetPath: string,
  options: CheckOptions,
): Promise<void> {
  if (options.verifyOnly) return verifyBuilds(targetPath, options);
  return runTasks(targetPath, options, "build");
}

/**
 * Flags that have no meaning for a harness proof (it runs per build, with no
 * agent, context, sampling, or threshold). Passing one is a usage error rather
 * than a silent no-op. Pure so the validation is testable without exiting.
 * Allowed alongside --verify-only: --task, --json, --output, --verbose.
 */
export function verifyOnlyMisusedFlags(options: CheckOptions): string[] {
  const irrelevant: Array<[string, unknown]> = [
    ["--agent", options.agent],
    ["--context", options.context],
    ["--sample", options.sample],
    ["--seed", options.seed],
    ["--max-cells", options.maxCells],
    ["--threshold", options.threshold],
    ["--plan", options.plan],
    ["--keep-on-failure", options.keepOnFailure],
  ];
  return irrelevant
    .filter(([, value]) => value !== undefined && value !== false)
    .map(([flag]) => flag);
}

/**
 * Prove each build's verifier without spending tokens: preflight + reference
 * control, per build. Writes JSON to `--output` or prints it with `--json`,
 * else the terminal proof view. Exits non-zero if any harness is broken; an
 * unproven harness (no reference solution declared) is honest, not a failure.
 */
async function verifyBuilds(
  targetPath: string,
  options: CheckOptions,
): Promise<void> {
  const misused = verifyOnlyMisusedFlags(options);
  if (misused.length > 0) {
    console.error(
      chalk.red(
        `${misused.join(", ")} ${misused.length === 1 ? "is" : "are"} not valid with --verify-only.`,
      ),
    );
    console.error(
      chalk.dim(
        "--verify-only proves each build's harness with no agent run. Valid flags: --task, --json, --output, --verbose.",
      ),
    );
    process.exit(1);
  }

  const resolvedPath = path.resolve(targetPath);

  let config: Config;
  try {
    config = await loadConfig(resolvedPath);
  } catch (error) {
    console.error(chalk.red(error instanceof Error ? error.message : error));
    console.error();
    console.error(chalk.dim("Run `pickled init` to create a config file"));
    process.exit(1);
  }

  if (config.builds.length === 0) {
    if (options.output) await Bun.write(options.output, "[]\n");
    else if (options.json) console.log("[]");
    else console.log(chalk.dim("No builds in pickled.yml. Nothing to prove."));
    return;
  }

  if (options.task && !config.builds.some((b) => b.id === options.task)) {
    console.error(
      chalk.red(
        `Unknown task: "${options.task}". Available builds: ${config.builds
          .map((b) => b.id)
          .join(", ")}`,
      ),
    );
    process.exit(1);
  }

  const tool = {
    name: config.product.name,
    description: config.product.description,
    path: resolvedPath,
  };
  const results = await proveBuilds(tool, config, {
    taskFilter: options.task ? [options.task] : undefined,
    onProgress:
      options.verbose && !options.json
        ? (msg) => console.log(chalk.dim(`   ${msg}`))
        : undefined,
  });

  if (options.output) {
    await Bun.write(options.output, `${JSON.stringify(results, null, 2)}\n`);
  } else if (options.json) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    console.log(formatBuildProof(config.product.name, results));
    console.log();
  }

  if (results.some((r) => r.status === "broken")) process.exit(1);
}
