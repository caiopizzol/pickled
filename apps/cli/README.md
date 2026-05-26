# @pickled-dev/cli

> Pickled runs real agent questions across a matrix of interfaces, sources, and toolsets, then scores the answers with deterministic checks.

The CLI for [Pickled](https://pickled.dev). Use it locally or in CI to check what agents say about your product. No LLM grades another LLM.

Full docs: [docs.pickled.dev](https://docs.pickled.dev/).

## Install

```bash
bun add -g @pickled-dev/cli
# or run without installing:
bunx @pickled-dev/cli <command>
```

## Commands

- **`pickled init [path]`** writes a starter `pickled.yml`.
- **`pickled audit [path]`** scans agent-facing files (`CLAUDE.md`, `AGENTS.md`, `llms.txt`) for broken refs, oversized sections, and stale-pattern matches. No LLM calls.
- **`pickled check [path]`** runs the scenarios in `pickled.yml`, expands matrix cells, and scores each answer.

## Minimum config

A registered source is the truth Pickled is allowed to score against: a local file, a URL, or a codebase glob. Anything not registered does not count.

```yaml
tool:
  name: my-product
  description: short one-liner

docs:
  sources:
    readme: ./README.md

targets:
  quick:
    category: cli
    provider: claude-code
    model: claude-haiku-4-5

scenarios:
  - name: Install
    prompt: How do I install my-product?
    requiredSources: [readme]

threshold: 60
```

That gets you a single controlled-mode scenario. To compare across interfaces, sources, or tool paths (web / MCP), add `matrix:` and `toolsets:`. See [Matrix evaluation](https://docs.pickled.dev/matrix-evaluation) and the [`pickled.yml` reference](https://docs.pickled.dev/pickled-yml).

## Matrix filters in CI

`pickled check` accepts `--interface`, `--source`, and `--toolset` flags so a GitHub Actions matrix can fan out one cell per job. Full workflow examples in [GitHub Actions](https://docs.pickled.dev/github-actions).

## Cost controls

For paid model targets, the matrix can expand to hundreds of cells per scenario. Four flags keep that in check without hand-editing axes:

```bash
pickled check . --plan                              # dry-run: no model calls
pickled check . --max-cells 10                      # hard fail if > 10 cells
pickled check . --sample 2 --seed nightly-2026     # deterministic sample per scenario
```

The receipt records `expandedCells`, `selectedCells`, and `seed` so a reviewer can see what ran and rerun the same sample.

## Current support

| Axis | Works today |
| --- | --- |
| Sources | local files, URLs, codebase globs |
| Toolsets | `none`, `web`, `mcp` |
| Interfaces | Claude Code, Codex CLI, Anthropic API, OpenAI API |
| Output | terminal, JSON, markdown audit reports |

## Read more

- [Getting started](https://docs.pickled.dev/getting-started)
- [Matrix evaluation](https://docs.pickled.dev/matrix-evaluation)
- [Toolsets](https://docs.pickled.dev/toolsets)
- [`pickled.yml` reference](https://docs.pickled.dev/pickled-yml)
- [GitHub Actions](https://docs.pickled.dev/github-actions)

## License

MIT
