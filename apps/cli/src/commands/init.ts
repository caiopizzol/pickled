import path from "node:path";
import chalk from "chalk";

const TEMPLATE = `# pickled.yml - Agent legibility check for your product

tool:
  name: "your-product"
  description: "A short description of what your product does"

docs:
  sources:
    readme: ./README.md
    # llms: https://your-site.example/llms.txt

scenarios:
  - name: "Getting started"
    prompt: "How do I install and set up this product?"
    requiredSources: [readme]

  - name: "Basic usage"
    prompt: "Show me a basic example of using this product"
    requiredSources: [readme]

# Optional: fail CI if score falls below threshold
# threshold: 80
`;

export async function init(targetPath: string): Promise<void> {
  const resolvedPath = path.resolve(targetPath);
  const configPath = `${resolvedPath}/pickled.yml`;

  const file = Bun.file(configPath);
  if (await file.exists()) {
    console.error(chalk.red("pickled.yml already exists"));
    process.exit(1);
  }

  await Bun.write(configPath, TEMPLATE);
  console.log(chalk.green("Created pickled.yml"));
  console.log();
  console.log(chalk.dim("Next steps:"));
  console.log(
    chalk.dim("  1. Edit pickled.yml: list your sources and scenarios"),
  );
  console.log(chalk.dim("  2. Run: pickled check"));
  console.log();
}
