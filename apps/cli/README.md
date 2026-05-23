# @pickled-dev/cli

> Pickled runs real agent questions across a matrix of interfaces, sources, and toolsets, then scores the answers with deterministic checks.

CLI for [pickled](https://pickled.dev). Full docs at [docs.pickled.dev/docs](https://docs.pickled.dev/docs).

## Install

```bash
bun add -g @pickled-dev/cli
# or invoke without installing:
bunx @pickled-dev/cli <command>
```

## Commands

### `pickled init [path]`

Write a starter `pickled.yml` in the target directory.

### `pickled audit [path]`

Static scan of agent-context files (`CLAUDE.md`, `AGENTS.md`, `llms.txt`, `.claude/rules/*.md`). No LLM calls.

| Option | Description |
| --- | --- |
| `--format <name>` | `terminal` (default), `markdown`, or `json` |
| `--json` | Shorthand for `--format json` |
| `-o, --output <file>` | Save report to file |
| `--fail-on <level>` | Exit non-zero on `error` (default) or `warning` |

### `pickled check [path]`

Run agent scenarios; score each cell against its declared contract.

| Option | Description |
| --- | --- |
| `--json` | Output as JSON |
| `-o, --output <file>` | Save JSON report to file |
| `-v, --verbose` | Show progress while scenarios run |
| `-t, --threshold <n>` | Minimum overall score to pass |
| `--target <name>` | Restrict to the named top-level matrix target |
| `--scenario <name>` | Run only the named scenario |
| `--interface <name>` | Matrix cell filter: this interface only |
| `--source <name>` | Matrix cell filter: this source id only |
| `--toolset <name>` | Matrix cell filter: this toolset name only |

The cell filters work with `scenario.matrix`. Designed for GitHub Actions matrices that run one cell per job:

```yaml
strategy:
  matrix:
    interface: [quick]
    source: [docs_site, readme]
    toolset: [none, web]
steps:
  - run: |
      pickled check \
        --interface "${{ matrix.interface }}" \
        --source "${{ matrix.source }}" \
        --toolset "${{ matrix.toolset }}"
```

See [GitHub Actions](https://docs.pickled.dev/docs/github-actions) for full workflow examples.

## Minimal `pickled.yml`

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

Full schema: [`pickled.yml` reference](https://docs.pickled.dev/docs/pickled-yml).

## Sources, toolsets, targets

| Source type | Description |
| --- | --- |
| `file` | A local path. String form `readme: ./README.md` resolves to this. |
| `url` | An `http(s)://` URL. Fetched at check time. |
| `codebase` | A glob expanded into one logical source. Object form with `type: codebase`. |

| Toolset shape | Available on | Source injected? |
| --- | --- | --- |
| `none` | every interface | yes (controlled) |
| `web` (`webSearch`/`webFetch`) | `claude-code` only | no (discovery via tools) |
| `mcp` (`mcpServers` map) | `claude-code` only | no (discovery via MCP) |

| Target | Provider | Notes |
| --- | --- | --- |
| `claude-code` | Claude Agent SDK | CLI. Accepts `model`, `maxTurns`, `maxThinkingTokens`, `maxBudgetUsd`, `permissionMode`. |
| `codex-cli` | Codex CLI binary | CLI. `model` required (Codex default changes silently). `maxTurns` rejected. |
| `anthropic` | Anthropic Messages API | API. No tools, no workspace. `model` required. Rejects CLI-only fields. |

String values in `pickled.yml` matching `${UPPER_SNAKE_CASE}` are expanded from `process.env` at load, so MCP auth headers and API keys stay out of the config file. Bun auto-loads `.env`.

Per-shape examples and detailed semantics live in the docs:

- [Toolsets](https://docs.pickled.dev/docs/toolsets)
- [`pickled.yml` reference](https://docs.pickled.dev/docs/pickled-yml)

## Result labels

| Label | Meaning |
| --- | --- |
| `Well grounded` | Required signals satisfied. No unknowns. High confidence. |
| `Grounded` | Required signals satisfied. Lower confidence. |
| `Partially grounded` | Some required signals missing, or unknowns appeared. |
| `Trap fired` | A declared stale pattern matched. Hard veto to `NO` / `0`. |
| `Ungrounded` | No valid signals, or every signal is unknown. |
| `Error` | The target failed before pickled could score the response. |

## Local development

From the monorepo root:

```bash
bun install
bun run dev:cli -- init
bun run dev:cli -- check
```

## License

MIT
