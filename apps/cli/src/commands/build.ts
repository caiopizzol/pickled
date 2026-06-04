import { type CheckOptions, runTasks } from "./check.js";

/**
 * `pickled build`: run the build tasks. The agent edits a fresh workspace per
 * trial and the cell result is k/n by context. Shares cell planning, sampling,
 * --max-cells, and --plan with `pickled check` via runTasks.
 */
export async function build(
  targetPath: string,
  options: CheckOptions,
): Promise<void> {
  return runTasks(targetPath, options, "build");
}
