# @pickled-dev/cli

> Pickled runs real agent questions across a matrix of interfaces, sources, and toolsets, then scores the answers with deterministic checks.

The CLI for [Pickled](https://pickled.dev). Use it locally or in CI to check what agents say about your product.

Full docs: [docs.pickled.dev/docs](https://docs.pickled.dev/docs).

## Install

```bash
bun add -g @pickled-dev/cli
```

Or run without installing:

```bash
bunx @pickled-dev/cli <command>
```

## Commands

```bash
pickled init [path]
```

Create a starter `pickled.yml`.

```bash
pickled audit [path]
```

Run a static scan of agent-facing files like `CLAUDE.md`, `AGENTS.md`, and `llms.txt`. No agent calls.

```bash
pickled check [path]
```

Run the scenarios in `pickled.yml`, expand matrix cells, and score each answer.

## Tiny Config

```yaml
tool:
  name: my-product
  description: short one-liner

docs:
  sources:
    readme: ./README.md
    docs_url: https://docs.my-product.dev/llms-full.txt

targets:
  quick:
    category: cli
    provider: claude-code
    model: claude-haiku-4-5

toolsets:
  none: {}
  web:
    webSearch: true
    webFetch: true

scenarios:
  - name: Install
    prompt: How do I install my-product?
    matrix:
      interfaces: [quick]
      sources: [readme, docs_url]
      toolsets: [none, web]
    expected:
      includes: ["bunx my-product"]

threshold: 60
```

That scenario runs four cells: two sources times two toolsets. `none` cells inject the source into the prompt. `web` cells do not inject source content; they require the agent to use WebSearch or WebFetch.

Add `requiredSources` when a controlled `none` cell must cite a source.

## What Gets Scored

- **Expected text.** `expected.includes` and `expected.excludes` are literal checks.
- **Traps.** A declared stale pattern forces `NO` with confidence `0`.
- **Citations.** `requiredSources` applies to controlled `none` cells.
- **Tool use.** `web` and `mcp` cells must invoke their configured tools. Prior model knowledge does not count.

No LLM grades another LLM.

## Matrix Filters

Use cell filters when you want one GitHub Actions job per matrix cell:

```yaml
strategy:
  matrix:
    interface: [quick]
    source: [docs_url, readme]
    toolset: [none, web]
steps:
  - run: |
      pickled check \
        --interface "${{ matrix.interface }}" \
        --source "${{ matrix.source }}" \
        --toolset "${{ matrix.toolset }}"
```

The same filters work locally:

```bash
pickled check . --interface quick --source docs_url --toolset web
```

## Current Support

| Axis | Works today |
| --- | --- |
| Sources | local files, URLs, codebase globs |
| Toolsets | `none`, `web`, `mcp` |
| Interfaces | Claude Code, Codex CLI, Anthropic API |
| Output | terminal, JSON, markdown audit reports |

Details live in the docs:

- [Getting started](https://docs.pickled.dev/docs/getting-started)
- [Matrix evaluation](https://docs.pickled.dev/docs/matrix-evaluation)
- [Toolsets](https://docs.pickled.dev/docs/toolsets)
- [`pickled.yml` reference](https://docs.pickled.dev/docs/pickled-yml)
- [GitHub Actions](https://docs.pickled.dev/docs/github-actions)

## Local Development

From the monorepo root:

```bash
bun install
bun run dev:cli -- init
bun run dev:cli -- check
```

## License

MIT
