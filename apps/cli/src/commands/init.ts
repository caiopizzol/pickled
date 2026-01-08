import path from "node:path";
import chalk from "chalk";

const TEMPLATE = `# 🥒 pickled.yml - Check your freshness!

tool:
  name: "your-tool"
  description: "A short description of what your tool does"

# Scenarios: Questions to test AI's knowledge of your tool
scenarios:
  - name: "Getting started"
    prompt: "How do I install and set up this tool?"

  - name: "Basic usage"
    prompt: "Show me a basic example of using this tool"

  - name: "Error handling"
    prompt: "How do I handle errors?"

# Optional: Fail CI if freshness score below threshold
# threshold: 80

# Advanced: Named targets for testing across different AI tools
# targets:
#   claude-sonnet:
#     category: cli
#     provider: claude-code
#     model: claude-sonnet-4-20250514
#
# Then reference in scenarios:
# scenarios:
#   - name: "Test with Sonnet"
#     prompt: "How do I install?"
#     target: claude-sonnet
`;

export async function init(targetPath: string): Promise<void> {
  const resolvedPath = path.resolve(targetPath);
  const configPath = `${resolvedPath}/pickled.yml`;

  const file = Bun.file(configPath);
  if (await file.exists()) {
    console.error(chalk.red("🥒 pickled.yml already exists"));
    process.exit(1);
  }

  await Bun.write(configPath, TEMPLATE);
  console.log(chalk.green("🥒 Created pickled.yml"));
  console.log();
  console.log(chalk.dim("Next steps:"));
  console.log(
    chalk.dim("  1. Edit pickled.yml with your tool info and scenarios"),
  );
  console.log(chalk.dim("  2. Run: pickled check"));
  console.log();
  console.log(chalk.dim("Stay fresh! 🥒"));
}
