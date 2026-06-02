import path from "node:path";
import chalk from "chalk";

const TEMPLATE = `# yaml-language-server: $schema=https://pickled.dev/schema/pickled.schema.json
# pickled.yml - does an agent understand your product?

product:
  name: your-product
  description: A short description of what your product does

# The public context an outside agent can read about your product.
sources:
  readme: ./README.md
  # docs: https://your-site.example/llms.txt

# The agent that answers. claude-code needs the Claude Code CLI installed.
agents:
  claude:
    provider: claude-code
    model: claude-haiku-4-5

# Named context paths. Each pairs a source with a tool mode. The point is
# to compare them: ask the same question down each path and see which one
# gets the agent to the right answer.
access:
  memory: { source: none, tools: none } # no context, model memory only
  given_readme: { source: readme, tools: none } # your README injected

questions:
  - id: getting-started
    ask: How do I install and set up this product?
    agents: [claude]
    access: [memory, given_readme]
    checks:
      # Edit these: phrases a correct answer must (or must not) contain.
      mustMention: [install]
      # mustNotMention: [deprecated-thing]
      # mustMentionOneOf:
      #   - label: names the entry point
      #     values: [quickstart, getting-started]

# Optional: fail CI if the overall score falls below this.
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
    chalk.dim("  1. Edit pickled.yml: list your sources and questions"),
  );
  console.log(chalk.dim("  2. Preview the run: pickled check --plan"));
  console.log(chalk.dim("  3. Run it: pickled check"));
  console.log();
}
