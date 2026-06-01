import path from "node:path";
import { loadConfig, runExampleTests } from "@pickled-dev/core";
import chalk from "chalk";

export interface TestOptions {
  scenario?: string;
}

/**
 * `pickled test` - score declared example answers (`examples.pass` /
 * `examples.fail`) against each scenario's deterministic contract, offline.
 * Zero model calls. Catches brittle checks and false-firing traps before a
 * paid run. Exits non-zero if any example does not behave as declared.
 */
export async function test(
  targetPath: string,
  options: TestOptions,
): Promise<void> {
  const resolvedPath = path.resolve(targetPath);

  let config: Awaited<ReturnType<typeof loadConfig>>;
  try {
    config = await loadConfig(resolvedPath);
  } catch (error) {
    console.error(chalk.red(error instanceof Error ? error.message : error));
    process.exit(1);
  }

  if (options.scenario) {
    const match = config.scenarios.filter((s) => s.name === options.scenario);
    if (match.length === 0) {
      console.error(chalk.red(`No scenario named "${options.scenario}".`));
      process.exit(1);
    }
    config = { ...config, scenarios: match };
  }

  const report = runExampleTests(config);

  if (report.total === 0) {
    console.log(
      chalk.dim(
        "No examples declared. Add examples.pass / examples.fail to a scenario to test its checks offline.",
      ),
    );
    return;
  }

  for (const s of report.scenarios) {
    console.log(chalk.bold(s.scenario));
    for (const r of s.results) {
      const mark = r.ok ? chalk.green("✓") : chalk.red("✗");
      const label = r.kind === "pass" ? "pass" : "fail";
      const snippet = r.response.replace(/\s+/g, " ").slice(0, 64);
      console.log(`  ${mark} ${chalk.dim(`[${label}]`)} ${snippet}`);
      if (!r.ok) {
        const why =
          r.kind === "pass"
            ? `expected to pass, but: ${r.reasons.join("; ")}`
            : `expected to fail, but the contract passed it (checks satisfied, no traps fired)`;
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
        `${report.mismatches} of ${report.total} example(s) did not match (${passed} ok). The checks or traps need adjusting.`,
      ),
    );
    process.exit(1);
  }
}
