import path from "node:path";
import type { Config } from "@pickled-dev/config";
import { loadConfig, runExampleTests } from "@pickled-dev/core";
import chalk from "chalk";

export interface TestOptions {
  task?: string;
}

/**
 * `pickled test` - score declared example answers (`examples.pass` /
 * `examples.fail`) against each question's fact/misstatement contract, offline.
 * Zero model calls. Catches a brittle or mis-specified contract before a paid
 * run. Exits non-zero if any example does not behave as declared.
 */
export async function test(
  targetPath: string,
  options: TestOptions,
): Promise<void> {
  const resolvedPath = path.resolve(targetPath);

  let config: Config;
  try {
    config = await loadConfig(resolvedPath);
  } catch (error) {
    console.error(chalk.red(error instanceof Error ? error.message : error));
    process.exit(1);
  }

  if (options.task) {
    const match = config.questions.filter((q) => q.id === options.task);
    if (match.length === 0) {
      console.error(chalk.red(`No question named "${options.task}".`));
      process.exit(1);
    }
    config = { ...config, questions: match };
  }

  const report = runExampleTests(config);

  if (report.total === 0) {
    console.log(
      chalk.dim(
        "No examples declared. Add examples.pass / examples.fail to a question to test its contract offline.",
      ),
    );
    return;
  }

  for (const q of report.questions) {
    console.log(chalk.bold(q.question));
    for (const r of q.results) {
      const mark = r.ok ? chalk.green("✓") : chalk.red("✗");
      const snippet = r.response.replace(/\s+/g, " ").slice(0, 64);
      console.log(`  ${mark} ${chalk.dim(`[${r.kind}]`)} ${snippet}`);
      if (!r.ok) {
        const why =
          r.kind === "pass"
            ? `expected YES, but: ${r.reasons.join("; ")}`
            : `expected to fail, but: ${r.reasons.join("; ")}`;
        console.log(chalk.red(`      ${why}`));
      }
    }
    console.log();
  }

  const passed = report.total - report.mismatches;
  if (report.mismatches === 0) {
    console.log(
      chalk.green(`All ${report.total} example(s) behaved as declared.`),
    );
  } else {
    console.log(
      chalk.red(
        `${report.mismatches} of ${report.total} example(s) did not match (${passed} ok). The contract needs adjusting.`,
      ),
    );
    process.exit(1);
  }
}
