import { type CheckOptions, runTasks } from "./check.js";

/**
 * `pickled build`: run only the build tasks (kind: build). The agent edits a
 * fresh workspace per trial and the result is k/n by access path. Shares the
 * matrix machinery (cells, sampling, --max-cells, --plan) with `pickled check`
 * via runTasks; build tasks are filtered in there.
 */
export async function build(
  targetPath: string,
  options: CheckOptions,
): Promise<void> {
  return runTasks(targetPath, options, "build");
}
