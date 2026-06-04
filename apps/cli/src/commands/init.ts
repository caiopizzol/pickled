import path from "node:path";
import chalk from "chalk";

const TEMPLATE = `# yaml-language-server: $schema=https://pickled.dev/schema/pickled.schema.json
# pickled.yml - does an agent understand your product?

schemaVersion: 2

product:
  name: your-product
  description: A short description of what your product does

# The public context an outside agent can read about your product.
sources:
  readme: { path: ./README.md }
  # docs: { url: https://your-site.example/llms.txt }

# The agent that answers. claude-code needs the Claude Code CLI installed.
agents:
  claude:
    provider: claude-code
    model: claude-haiku-4-5

# Named contexts: how a source reaches the agent. The point is to compare
# them - run the same question down each and see which path gets it right.
contexts:
  memory: { mode: memory } # prior knowledge only, nothing injected
  from_readme: { mode: inject, source: readme } # your README placed in context

# Reusable product truths an answer must cover (the coverage axis).
facts:
  install_command:
    statement: The product is installed with its documented command.
    match:
      allOf: ["install"] # edit: a substring a correct answer must contain

# Reusable wrong claims an answer must not make (the precision axis).
# misstatements:
#   deprecated_path:
#     statement: The answer recommends a deprecated install path.
#     match:
#       anyOf: ["old-deprecated-command"]

# Questions probe whether the agent can surface the facts from a context.
questions:
  - id: getting-started
    question: How do I install and set up this product?
    agents: [claude]
    contexts: [memory, from_readme]
    expects: [install_command]
    # rejects: [deprecated_path]   # if set, examples.pass + examples.fail are required

# Builds prove the agent can implement with your product (optional).
# builds:
#   - id: smoke
#     goal: Add a basic usage of the product to the fixture.
#     agents: [claude]
#     contexts: [from_readme]
#     workspace: { path: ./fixtures/app, setup: [npm install] }
#     verifier:
#       failToPass: [{ run: npm test }]

# Optional per-kind gates: fail CI if the score falls below these (1-100).
# thresholds:
#   questions: 80
#   builds: 80
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
  console.log(chalk.dim("  1. Edit pickled.yml: list your sources and tasks"));
  console.log(chalk.dim("  2. Preview the run: pickled check --plan"));
  console.log(chalk.dim("  3. Run it: pickled check"));
  console.log();
}
