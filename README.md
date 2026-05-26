# 🥒 pickled

> Pickled runs real agent questions across a matrix of interfaces, sources, and toolsets, then scores the answers with deterministic checks.

## Why

Docs can be correct and agents can still answer wrong. Pickled gives you receipts: per-cell verdicts showing which interface, which source, and which tool path produced which answer. No LLM grades another LLM.

## How it works

Four terms:

- **Interface** is which agent runs the scenario: Claude Code, Codex CLI, Anthropic API, OpenAI API.
- **Source** is the truth Pickled is allowed to score against: a local file, a URL, or a codebase glob. Anything not registered does not count.
- **Toolset** is what tools the agent has: `none` (controlled, source content injected), `web` (Claude Code `WebSearch`/`WebFetch`, or Anthropic and OpenAI API server-side `web_search`), `mcp` (any MCP server you declare).
- **Scenario** is the question. A scenario can expand into one cell per `(interface × source × toolset)` tuple.

## What it checks

- **Expected facts are present.** `expected.includes` is a list of literal substrings the answer must contain. `expected.excludes` is the inverse.
- **Stale claims are trapped.** `traps` are deterministic detectors (literal substring or regex). Any trap firing forces `NO` with confidence `0`.
- **Required citations are present in controlled cells.** `requiredSources` lists the source IDs the answer must cite in `none`-toolset cells.
- **Tool-enabled cells actually use the configured tools.** A `web` or `mcp` cell that answers without invoking any of the configured tools is vetoed to `NO`. Model prior knowledge does not count as evidence for the tool path.
- **No LLM grades another LLM.** Every signal is either a substring check, a regex match, a registered-source citation, or a recorded tool invocation.

## Quick start

```bash
bunx @pickled-dev/cli init
bunx @pickled-dev/cli check .
```

## Tiny config

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

That scenario runs four cells (two sources × two toolsets) and grades each independently. The `none` cells inject the source content into the prompt; the `web` cells leave the source as a discovery hint and require the agent to actually invoke a web tool (`WebSearch`/`WebFetch` on Claude Code, server-side `web_search` on the Anthropic and OpenAI API targets) to reach it. Every cell checks `expected.includes` (this example pins `"bunx my-product"`); add `requiredSources` to a `none` cell when you also want a citation contract.

## Read more

Full docs: [docs.pickled.dev](https://docs.pickled.dev/).

- [Getting started](https://docs.pickled.dev/getting-started)
- [Matrix evaluation](https://docs.pickled.dev/matrix-evaluation)
- [Toolsets](https://docs.pickled.dev/toolsets)
- [`pickled.yml` reference](https://docs.pickled.dev/pickled-yml)
- [GitHub Actions](https://docs.pickled.dev/github-actions)

## License

MIT
