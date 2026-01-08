#!/usr/bin/env bun
import { program } from "commander";
import pkg from "../package.json";
import { check } from "./commands/check.js";
import { init } from "./commands/init.js";

program
  .name("pickled")
  .description("Test your freshness with AI 🥒")
  .version(pkg.version);

program
  .command("init")
  .description("Create a pickled.yml config file")
  .argument("[path]", "Path to your project (default: current directory)", ".")
  .action(init);

program
  .command("check")
  .description("Check if AI can answer questions about your tool")
  .argument("[path]", "Path to your project (default: current directory)", ".")
  .option("--json", "Output as JSON")
  .option("-o, --output <file>", "Save report to file")
  .option("-v, --verbose", "Show detailed progress")
  .option(
    "-t, --threshold <percent>",
    "Minimum score % to pass (overrides config)",
  )
  .action(check);

program.parse();
