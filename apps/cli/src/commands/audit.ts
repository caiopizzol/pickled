import path from "node:path";
import {
  renderAuditJSON,
  renderAuditMarkdown,
  renderAuditTerminal,
  scan,
} from "@pickled-dev/core";
import chalk from "chalk";

export interface AuditOptions {
  format?: string;
  json?: boolean;
  output?: string;
  failOn?: string;
}

type Format = "terminal" | "markdown" | "json";

function resolveFormat(options: AuditOptions): Format {
  // --json is a shorthand for --format json. --format wins if both are passed.
  if (options.format && options.format !== "terminal") {
    return options.format as Format;
  }
  if (options.json) return "json";
  return (options.format as Format) ?? "terminal";
}

export async function audit(
  targetPath: string,
  options: AuditOptions,
): Promise<void> {
  const { output } = options;
  const format = resolveFormat(options);
  const resolvedPath = path.resolve(targetPath);

  let result: Awaited<ReturnType<typeof scan>>;
  try {
    result = await scan({ targetRepo: resolvedPath });
  } catch (error) {
    console.error(chalk.red(error instanceof Error ? error.message : error));
    process.exit(1);
  }

  let rendered: string;
  if (format === "json") {
    rendered = renderAuditJSON(result);
  } else if (format === "markdown") {
    rendered = renderAuditMarkdown(result);
  } else {
    rendered = renderAuditTerminal(result);
  }

  if (output) {
    await Bun.write(output, rendered);
  } else {
    await writeStdout(`${rendered}\n`);
  }

  const errors = result.findings.filter((f) => f.severity === "error").length;
  const warnings = result.findings.filter(
    (f) => f.severity === "warning",
  ).length;

  // Plain JSON output stays machine-clean; everything else gets a colored
  // summary line.
  if (format !== "json" && !output) {
    console.log();
    if (errors === 0 && warnings === 0) {
      console.log(chalk.green("Audit clean. No issues found."));
    } else {
      const tone = errors > 0 ? chalk.red : chalk.yellow;
      console.log(
        tone(`Audit found ${errors} error(s), ${warnings} warning(s).`),
      );
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
