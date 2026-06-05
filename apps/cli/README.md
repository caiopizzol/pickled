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
- **`pickled ci [path]`** runs the configured questions and builds in one pass, writes a receipt per kind, and gates the run. For CI.
- **`pickled audit [path]`** scans agent-facing files for broken refs and oversized sections. No model calls.
- **`pickled report <file>`** re-renders a saved receipt as terminal, markdown, or JSON. No model calls.

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
pickled build . --verify-only                    # prove the harness; no agent runs
```

`pickled build --verify-only` runs each build's preflight and reference control (the untouched fixture must fail `failToPass` and pass `passToPass`; a declared `referenceSolution` must apply and clear the verifier) and prints one line per build: `proven`, `unproven` (no reference declared), or `broken`. No agent runs, so it is the cheap way to check a fixture before spending tokens, and it exits non-zero if any harness is broken. `--output file.json` writes the per-build proof results as JSON (or `--json` to print them to stdout). It accepts only `--task`, `--json`, `--output`, and `--verbose`; the agent, sampling, and threshold flags are rejected rather than silently ignored.

The receipt records `expandedCells`, `selectedCells`, and `seed` so a reviewer can see what ran and rerun the same sample. Builds also report `selectedExecutions` (cells x trials), which is what `--max-cells` gates.

Narrow a run by the names in `pickled.yml`:

```bash
pickled check . --task install
pickled check . --agent quick
pickled check . --context from_readme
```

## In CI

`pickled ci` runs the configured questions and builds in one pass, writes a CI-safe JSON receipt per kind, appends a markdown summary to the job summary, and exits non-zero if any thresholded run fails:

```yaml
- run: |
    pickled ci . \
      --questions-max-cells 20 \
      --builds-max-cells 4 \
      --report-dir pickled-reports
- uses: actions/upload-artifact@v4
  if: always()
  with:
    name: pickled-reports
    path: pickled-reports/*.json
```

It appends markdown to `$GITHUB_STEP_SUMMARY` automatically when that variable is set (override with `--summary-file`). It runs both kinds to completion even if one fails its threshold, so the job always uploads every receipt. With no `--questions`/`--builds` flag it runs both kinds the config declares.

The receipts are CI-safe by default: verdicts, evidence ids, provenance, and build attempts, without full answers, source text, transcripts, diffs, or command output. To re-render a saved receipt later (for example a different format from an uploaded artifact) without rerunning paid agents, use `pickled report <file> --format markdown|terminal|json`; pass `--verbose` there for a forensic receipt.

## Current support

| Concept | Works today |
| --- | --- |
| Sources | local files, URLs, codebase globs |
| Context modes | `memory`, `inject`, `web`, `mcp` |
| Agents | Claude Code, Codex CLI, Anthropic API, OpenAI API |
| Output | terminal and JSON for runs; markdown from saved receipts and audits |

## Read more

- [Getting started](https://docs.pickled.dev/getting-started)
- [`pickled.yml` reference](https://docs.pickled.dev/pickled-yml)
- [GitHub Actions](https://docs.pickled.dev/github-actions)

## License

MIT
