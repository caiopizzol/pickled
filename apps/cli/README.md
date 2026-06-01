# @pickled-dev/cli

> Pickled asks your product's real questions at real agents, down different context paths, then scores the answers with deterministic checks.

The CLI for [Pickled](https://pickled.dev). Use it locally or in CI to check whether agents can answer from the product context you publish. No LLM grades another LLM.

Full docs: [docs.pickled.dev](https://docs.pickled.dev/).

## Install

```bash
bun add -g @pickled-dev/cli
# or run without installing:
bunx @pickled-dev/cli <command>
```

## Commands

- **`pickled init [path]`** writes a starter `pickled.yml`.
- **`pickled test [path]`** scores `examples.pass` and `examples.fail` offline. No model calls.
- **`pickled check [path]`** asks the configured agents and scores their answers.
- **`pickled audit [path]`** scans agent-facing files for broken refs and oversized sections. No model calls.

## Minimum config

A registered source is the context Pickled is allowed to use: a local file or a URL. Anything not registered does not count.

```yaml
product:
  name: my-product
  description: short one-liner about what your product does

sources:
  readme: ./README.md

agents:
  quick:
    provider: claude-code
    model: claude-haiku-4-5

access:
  injected: { source: readme, tools: none }

questions:
  - id: install
    ask: How do I install my-product?
    agents: [quick]
    access: [injected]
    checks:
      mustMention: ["bunx my-product"]

threshold: 80
```

That runs one question with your README injected. Add more `access` paths to compare model prior, injected context, web discovery, and MCP discovery.

## Cost controls

For paid model targets, a run can expand to many `(agent x access)` cells. Three flags keep that in check:

```bash
pickled check . --plan                           # dry run: no model calls
pickled check . --max-cells 10                   # fail before spending
pickled check . --sample 2 --seed nightly-2026  # deterministic sample per question
```

The receipt records `expandedCells`, `selectedCells`, and `seed` so a reviewer can see what ran and rerun the same sample.

## Current support

| Concept | Works today |
| --- | --- |
| Sources | local files, URLs |
| Access tools | `none`, `web`, `mcp` |
| Agents | Claude Code, Codex CLI, Anthropic API, OpenAI API |
| Output | terminal, JSON, markdown audit reports |

## Read more

- [Getting started](https://docs.pickled.dev/getting-started)
- [`pickled.yml` reference](https://docs.pickled.dev/pickled-yml)
- [GitHub Actions](https://docs.pickled.dev/github-actions)

## License

MIT
