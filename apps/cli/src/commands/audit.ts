import path from "node:path";
import { renderAuditJSON, renderAuditMarkdown, scan } from "@pickled-dev/core";
import chalk from "chalk";

export interface AuditOptions {
  json?: boolean;
  output?: string;
  failOn?: string;
}

export async function audit(
  targetPath: string,
  options: AuditOptions,
): Promise<void> {
  const { json, output } = options;
  const resolvedPath = path.resolve(targetPath);

  let result: Awaited<ReturnType<typeof scan>>;
  try {
    result = await scan({ targetRepo: resolvedPath });
  } catch (error) {
    console.error(
      chalk.red(`🥒 ${error instanceof Error ? error.message : error}`),
    );
    process.exit(1);
  }

  const rendered = json ? renderAuditJSON(result) : renderAuditMarkdown(result);

  if (output) {
    await Bun.write(output, rendered);
  } else {
    await writeStdout(`${rendered}\n`);
  }

  const errors = result.findings.filter((f) => f.severity === "error").length;
  const warnings = result.findings.filter(
    (f) => f.severity === "warning",
  ).length;

  if (!json && !output) {
    console.log();
    if (errors === 0 && warnings === 0) {
      console.log(chalk.green(`🥒 Audit clean. No issues found.`));
    } else {
      const tone = errors > 0 ? chalk.red : chalk.yellow;
      console.log(tone(`🥒 ${errors} error(s), ${warnings} warning(s).`));
    }
  }

  const failOn = options.failOn ?? "error";
  const shouldFail = failOn === "warning" ? errors + warnings > 0 : errors > 0;
  if (shouldFail) process.exit(1);
}

function writeStdout(text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    process.stdout.write(text, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}
