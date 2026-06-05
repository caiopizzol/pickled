#!/usr/bin/env bun
import { Option, program } from "commander";
import pkg from "../package.json";
import { audit } from "./commands/audit.js";
import { build } from "./commands/build.js";
import { check } from "./commands/check.js";
import { init } from "./commands/init.js";
import { report } from "./commands/report.js";
import { test } from "./commands/test.js";

program
  .name("pickled")
  .description("Test what agents actually understand about your product")
  .version(pkg.version);

program
  .command("init")
  .description("Create a pickled.yml config file")
  .argument("[path]", "Path to your project (default: current directory)", ".")
  .action(init);

program
  .command("audit")
  .description("Static scan of agent-context files. No LLM calls.")
  .argument("[path]", "Path to your project (default: current directory)", ".")
  .addOption(
    new Option("--format <name>", "Output format")
      .choices(["terminal", "markdown", "json"])
      .default("terminal"),
  )
  .option("--json", "Shorthand for --format json")
  .option("-o, --output <file>", "Save report to file")
  .addOption(
    new Option("--fail-on <level>", "Exit non-zero on this severity or higher")
      .choices(["error", "warning"])
      .default("error"),
  )
  .action(audit);

program
  .command("check")
  .summary("Run questions against your sources")
  .description("Run questions: ask the agents and score their answers")
  .argument("[path]", "Project path", ".")
  .option("--json", "Output as JSON")
  .option("-o, --output <file>", "Save report to file")
  .option("-v, --verbose", "Show detailed progress")
  .option("-t, --threshold <percent>", "Minimum score to pass (1-100)")
  .option("--task <id>", "Run only the named task id")
  .option("--agent <name>", "Run only the named agent")
  .option("--context <name>", "Run only the named context")
  .option("--plan", "Print planned cells. No model calls.")
  .option("--max-cells <n>", "Abort if planned executions exceed N")
  .option("--sample <n>", "Sample N cells per task")
  .option("--seed <value>", "Seed for --sample")
  .action(check);

program
  .command("build")
  .summary("Run builds in a fresh workspace")
  .description(
    "Run builds: the agent edits a workspace, the verifier must pass",
  )
  .argument("[path]", "Project path", ".")
  .option("--json", "Output as JSON")
  .option("-o, --output <file>", "Save report to file")
  .option("-v, --verbose", "Show detailed progress")
  .option("-t, --threshold <percent>", "Minimum score to pass (1-100)")
  .option("--task <id>", "Run only the named task id")
  .option("--agent <name>", "Run only the named agent")
  .option("--context <name>", "Run only the named context")
  .option("--plan", "Print planned cells and executions. No agent runs.")
  .option("--max-cells <n>", "Abort if planned executions exceed N")
  .option("--sample <n>", "Sample N cells per task")
  .option("--seed <value>", "Seed for --sample")
  .option("--keep-on-failure", "Keep failed build workspaces for inspection")
  .action(build);

program
  .command("report")
  .summary("Re-render a saved receipt")
  .description(
    "Re-render a receipt saved by `check`/`build --output`. No model calls.",
  )
  .argument("<file>", "Path to a saved report JSON")
  .addOption(
    new Option("--format <name>", "Output format")
      .choices(["terminal", "markdown", "json"])
      .default("terminal"),
  )
  .option("--json", "Shorthand for --format json")
  .option("-o, --output <file>", "Write the rendered report to a file")
  .option("-v, --verbose", "Keep full evidence in JSON output (answers, diffs)")
  .action(report);

program
  .command("test")
  .summary("Check example answers offline")
  .description("Check example answers offline. No model calls.")
  .argument("[path]", "Path to your project (default: current directory)", ".")
  .option("--task <id>", "Test only the named task id")
  .action(test);

await program.parseAsync();
