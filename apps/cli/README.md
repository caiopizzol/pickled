# @pickled-dev/cli

> Pickled tests whether real agents can answer and build with your product, across declared context paths, using deterministic evidence.

The CLI for [Pickled](https://pickled.dev). Use it locally or in CI to check whether agents can answer and build from the product context you publish. No LLM grades another LLM.

Full docs: [docs.pickled.dev](https://docs.pickled.dev/).

## Install

```bash
bun add -g @pickled-dev/cli
# or run without installing:
bunx @pickled-dev/cli <command>
```

## Commands

- **`pickled init [path]`** writes a starter `pickled.yml`.
- **`pickled test [path]`** scores a question's `examples.pass` / `examples.fail` offline. No model calls.
- **`pickled check [path]`** runs the questions: asks the agents and scores their answers against the fact contract.
- **`pickled build [path]`** has edit-capable agents work in a fresh workspace and scores the `verifier`.
- **`pickled audit [path]`** scans agent-facing files for broken refs and oversized sections. No model calls.

## Minimum config

A registered source is the context Pickled is allowed to use: a local file or a URL. Anything not registered does not count.

```yaml
schemaVersion: 2

product:
  name: my-product
  description: short one-liner about what your product does

sources:
  readme: { path: ./README.md }

agents:
  quick:
    provider: claude-code
    model: claude-haiku-4-5

contexts:
  from_readme: { mode: inject, source: readme }

facts:
  install_command:
    statement: my-product installs with bunx my-product.
    match:
      allOf: ["bunx my-product"]

questions:
  - id: install
    question: How do I install my-product?
    agents: [quick]
    contexts: [from_readme]
    expects: [install_command]

thresholds:
  questions: 80
```

That runs one question with your README injected. Add more `contexts` to compare model memory, injected sources, web discovery, and MCP discovery. A `build` instead has the agent edit a workspace and runs your `verifier`; run it with `pickled build`.

## Cost controls

For paid agents, a run can expand to many `(agent × context)` cells. These flags keep that in check:

```bash
pickled check . --plan                           # dry run: no model calls
pickled check . --max-cells 10                   # fail before spending
pickled check . --sample 2 --seed nightly-2026   # deterministic sample per task
pickled build . --plan                           # preview build cells and executions
```

The receipt records `expandedCells`, `selectedCells`, and `seed` so a reviewer can see what ran and rerun the same sample. Builds also report `selectedExecutions` (cells x trials), which is what `--max-cells` gates.

Narrow a run by the names in `pickled.yml`:

```bash
pickled check . --task install
pickled check . --agent quick
pickled check . --context from_readme
```

## Current support

| Concept | Works today |
| --- | --- |
| Sources | local files, URLs, codebase globs |
| Context modes | `memory`, `inject`, `web`, `mcp` |
| Agents | Claude Code, Codex CLI, Anthropic API, OpenAI API |
| Output | terminal, JSON, markdown audit reports |

## Read more

- [Getting started](https://docs.pickled.dev/getting-started)
- [`pickled.yml` reference](https://docs.pickled.dev/pickled-yml)
- [GitHub Actions](https://docs.pickled.dev/github-actions)

## License

MIT
