#!/usr/bin/env bun
import { Option, program } from "commander";
import pkg from "../package.json";
import { audit } from "./commands/audit.js";
import { check } from "./commands/check.js";
import { init } from "./commands/init.js";

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
  .description(
    "Static scan of agent-context files (CLAUDE.md, AGENTS.md, llms.txt). No LLM calls.",
  )
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
  .description("Run agent scenarios against registered sources")
  .argument("[path]", "Path to your project (default: current directory)", ".")
  .option("--json", "Output as JSON")
  .option("-o, --output <file>", "Save report to file")
  .option("-v, --verbose", "Show detailed progress")
  .option(
    "-t, --threshold <percent>",
    "Minimum score % to pass (overrides config)",
  )
  .option(
    "--target <name>",
    "Run only the named target (overrides matrix.target)",
  )
  .action(check);

await program.parseAsync();
