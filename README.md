# 🥒 pickled

> Pickled tests whether real agents can answer and build with your product, across declared context paths, using deterministic evidence.

## Why

Docs can be correct and agents can still answer wrong. Pickled gives you receipts: per-cell verdicts showing which agent, which source, and which tool path produced which answer. No LLM grades another LLM.

## How it works

Four terms:

- **Agent** is who answers: Claude Code, Codex CLI, Anthropic API, OpenAI API.
- **Source** is the public context Pickled may score against: a local file or a URL. Anything not registered does not count.
- **Access** is a named context path: a `(source, tools)` pair. `tools` is `none` (the source is injected), `web`, or `mcp`.
- **Task** is the unit of work. An answer task asks a question and scores the answer with checks; a build task has the agent edit a workspace and passes when your `verify` commands do.

A task runs as one cell per `(agent × access)` pair, and each cell is graded on its own.

## What it checks

- **mustMention.** Substrings the answer must contain.
- **mustMentionOneOf.** Groups where the answer must contain at least one value from each group.
- **mustNotMention.** Substrings the answer must not contain.
- **Tool paths are real.** A `web` or `mcp` access path that answers without invoking any of its tools is vetoed to `NO`. Model memory does not count as evidence for a tool path.
- **No LLM grades another LLM.** Every signal is a substring check or a recorded tool invocation.

## Quick start

```bash
bunx @pickled-dev/cli init
bunx @pickled-dev/cli check .
```

## Tiny config

```yaml
product:
  name: my-product
  description: short one-liner

sources:
  readme: ./README.md
  docs: https://docs.my-product.dev/llms-full.txt

agents:
  quick:
    provider: claude-code
    model: claude-haiku-4-5

access:
  memory: { source: none, tools: none } # no context, model memory only
  given_docs: { source: docs, tools: none } # docs content injected
  web_open: { source: none, tools: web } # open web discovery

tasks:
  - id: install
    prompt: How do I install my-product?
    agents: [quick]
    access: [memory, given_docs, web_open]
    checks:
      mustMention: ["bunx my-product"]

threshold: 60
```

That task runs three cells, one per access path, and grades each on its own. `memory` answers from model memory; `given_docs` reads the docs you registered; `web_open` makes the agent reach the live site through web tools (a cell that answers without invoking a tool is vetoed). Every cell checks `mustMention`. Compare the verdicts to see which context path the agent actually needed to get it right.

## Read more

Full docs: [docs.pickled.dev](https://docs.pickled.dev/).

- [Getting started](https://docs.pickled.dev/getting-started)
- [`pickled.yml` reference](https://docs.pickled.dev/pickled-yml)
- [GitHub Actions](https://docs.pickled.dev/github-actions)

## License

MIT

## Contributors

<a href="https://github.com/caiopizzol"><img src="https://github.com/caiopizzol.png" width="50" height="50" alt="caiopizzol" title="Caio Pizzol" /></a>
