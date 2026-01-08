import chalk from "chalk";
import path from "node:path";

const TEMPLATE = `tool:
  name: "your-tool"
  description: "A short description of what your tool does"
  keywords:
    - keyword1
    - keyword2

scenarios:
  - name: "General discovery"
    prompt: "What's a good library for [your use case]?"

  - name: "Specific feature"
    prompt: "I need a tool that can [specific feature]. What should I use?"

# Optional: fail CI if freshness below threshold
# threshold: 50
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
  console.log(chalk.dim("  1. Edit pickled.yml with your tool info and scenarios"));
  console.log(chalk.dim("  2. Run: pickled check"));
}
