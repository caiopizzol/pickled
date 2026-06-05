# 🥒 pickled

> Pickled tests whether real agents can answer and build with your product, across declared context paths, using deterministic evidence.

## Why

Docs can be correct and agents can still answer wrong. Examples can be correct and agents can still build the wrong thing. Pickled gives you receipts: per-cell verdicts showing which agent, which source, and which context path produced which answer or build result. No LLM grades another LLM.

## How it works

Five terms:

- **Agent** is who answers: Claude Code, Codex CLI, Anthropic API, OpenAI API.
- **Source** is the public context Pickled may score against: a local file, a URL, or a codebase glob. Anything not registered does not count.
- **Context** is a named delivery path: a `mode` (`memory`, `inject`, `web`, or `mcp`) plus an optional source.
- **Question** asks something and scores the answer on declared facts (and rejected misstatements). **Build** has the agent edit a workspace and passes when the `verifier` does.
- **Fact / misstatement** are the reusable, deterministic match contracts a question scores against.

A task runs as one cell per `(agent × context)` pair, and each cell is graded on its own.

## What it checks

- **Facts.** Reusable product truths a question's answer must cover (`allOf` / `anyOf` substring matches, normalized).
- **Misstatements.** Reusable wrong claims the answer must not make. A match is a hard veto to `NO`.
- **Tool paths are real.** A `web` or `mcp` context that answers without invoking any of its tools is vetoed to `NO`. Model memory does not count as evidence for a tool path.
- **Builds prove themselves.** Builds pass or fail on a SWE-bench-style `verifier` (`failToPass` + `passToPass`).
- **No LLM grades another LLM.** Every signal is a substring match, a recorded tool invocation, or a command result.

## Quick start

```bash
bunx @pickled-dev/cli init
bunx @pickled-dev/cli check .
```

## Tiny config

```yaml
schemaVersion: 2

product:
  name: my-product
  description: short one-liner

sources:
  docs: { url: https://docs.my-product.dev/llms-full.txt }

agents:
  quick:
    provider: claude-code
    model: claude-haiku-4-5

contexts:
  memory: { mode: memory } # no context, model memory only
  given_docs: { mode: inject, source: docs } # docs content injected
  web_open: { mode: web } # open web discovery

facts:
  install_command:
    statement: my-product installs with bunx my-product.
    match:
      allOf: ["bunx my-product"]

questions:
  - id: install
    question: How do I install my-product?
    agents: [quick]
    contexts: [memory, given_docs, web_open]
    expects: [install_command]

thresholds:
  questions: 60
```

That question runs three cells, one per context, and grades each on its own. `memory` answers from model memory; `given_docs` reads the docs you registered; `web_open` makes the agent reach the live site through web tools (a cell that answers without invoking a tool is vetoed). Every cell scores the same fact. Compare the verdicts to see which context the agent actually needed to get it right.

## Builds

Questions check what the agent says. Builds check what the agent can do:

```yaml
builds:
  - id: add-toolbar
    goal: Add a toolbar using my-product.
    agents: [quick]
    contexts: [given_docs]
    trials: 3
    workspace:
      path: ./fixtures/app
      setup: [bun install]
    verifier:
      failToPass:
        - { run: bun test }
```

Run builds with `pickled build .`. Each `(agent × context)` cell runs in a fresh workspace for each trial and reports `Built k/n`, `Partially built k/n`, or `Did not build k/n`.

## Receipts

Save a run once, then render it without spending more tokens:

```bash
bunx @pickled-dev/cli check . --output pickled-report.json
bunx @pickled-dev/cli report pickled-report.json --format markdown
```

Default JSON is CI-safe: it keeps verdicts, scores, missing facts, misstatements, provenance, and build attempts, but strips source content, full agent answers, transcripts, diffs, and command output. Use `--verbose` when you need a forensic receipt.

## Read more

Full docs: [docs.pickled.dev](https://docs.pickled.dev/).

- [Getting started](https://docs.pickled.dev/getting-started)
- [`pickled.yml` reference](https://docs.pickled.dev/pickled-yml)
- [GitHub Actions](https://docs.pickled.dev/github-actions)

## License

MIT

## Contributors

<a href="https://github.com/caiopizzol"><img src="https://github.com/caiopizzol.png" width="50" height="50" alt="caiopizzol" title="Caio Pizzol" /></a>
