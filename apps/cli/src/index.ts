#!/usr/bin/env bun
import { program } from "commander";
import { check } from "./commands/check.js";

program
  .name("pickled")
  .description("Preserve your visibility in AI 🥒")
  .version("0.1.0");

program
  .command("check")
  .description("Check your freshness in AI")
  .argument("<repo>", "GitHub repo to check (e.g., github.com/user/repo)")
  .option("--json", "Output as fresh JSON")
  .option("-o, --output <file>", "Save report to file (.json or .xml)")
  .option("-v, --verbose", "Show the full pickling process")
  .option(
    "-c, --competitors <list>",
    "Comma-separated competitor list (skip auto-discovery)",
  )
  .action(check);

program.parse();
