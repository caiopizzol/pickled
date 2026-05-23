# @pickled-dev/cli

> Test what agents actually understand about your product

Pickled runs scenarios against real agent targets, checks citations against registered sources, and matches declared traps deterministically. No LLM grades another LLM.

## Installation

```bash
bun add -g @pickled-dev/cli
```

## Usage

### 1. Initialize config

```bash
pickled init
```

Creates a `pickled.yml` file:

```yaml
tool:
  name: "your-product"
  description: "What your product does"

docs:
  sources:
    readme: ./README.md

scenarios:
  - name: "Getting started"
    prompt: "How do I install and set up this product?"
    requiredSources: [readme]

threshold: 80
```

### 2. Edit your config

Declare the sources agents should cite, the scenarios they should answer, and any stale patterns you want traps to catch.

### 3. Run the check

```bash
pickled check
```

## Commands

### `pickled init [path]`

Create a starter `pickled.yml` config file.

### `pickled audit [path]`

Static scan of agent-context files. No LLM calls.

| Option                | Description                                          |
| --------------------- | ---------------------------------------------------- |
| `--format <name>`     | `terminal` (default), `markdown`, or `json`          |
| `--json`              | Shorthand for `--format json`                        |
| `-o, --output <file>` | Save report to file                                  |
| `--fail-on <level>`   | Exit non-zero on `error` (default) or `warning`      |

Default `terminal` format is plain text suited to CI logs. Use `--format markdown` for GitHub step summaries; `--format json` for machine consumers.

### `pickled check [path]`

Run agent scenarios against registered sources.

| Option                | Description                                                         |
| --------------------- | ------------------------------------------------------------------- |
| `--json`              | Output as JSON                                                      |
| `-o, --output <file>` | Save JSON report to file                                            |
| `-v, --verbose`       | Show progress while scenarios run                                   |
| `-t, --threshold <n>` | Minimum score percent needed to pass                                |
| `--target <name>`     | Restrict to the named target. Overrides `matrix.target` for non-matrix scenarios; for matrix scenarios, also acts as `--interface` unless that flag is explicitly set. |
| `--scenario <name>`   | Run only the named scenario (CI-matrix-friendly)                    |
| `--interface <name>`  | Matrix cell filter: run only cells with this interface. Takes precedence over `--target` for matrix cells. |
| `--source <name>`     | Matrix cell filter: run only cells with this source id              |
| `--toolset <name>`    | Matrix cell filter: run only cells with this toolset name           |

`--target` and `--interface` are related but distinct: `--target` is the legacy flag that narrows the top-level `matrix.target` axis (used before per-scenario `scenario.matrix.interfaces` shipped in v0.16.0). When `--target` is the only flag passed, the CLI also applies it as `--interface` so matrix scenarios narrow consistently. Pass `--interface` explicitly to override.

The cell filters work with `scenario.matrix` declarations. Designed for GitHub Actions matrix usage where each CI job runs one cell:

```yaml
# .github/workflows/pickled-matrix.yml
strategy:
  matrix:
    interface: [codex, claude_code]
    source: [docs_site, readme]
    toolset: [none]
steps:
  - run: |
      pickled check \
        --interface "${{ matrix.interface }}" \
        --source "${{ matrix.source }}" \
        --toolset "${{ matrix.toolset }}" \
        --output "pickled-report-${{ matrix.interface }}-${{ matrix.source }}-${{ matrix.toolset }}.json"
```

Each job uploads one receipt; a later job can merge or compare them. Full-matrix runs without filters work too; they just produce one report covering every declared cell.

## Example Output

```text
pickled check
-------------------------------------------------------
Tool: zod
Sources: [readme], [llms]
Scenarios: 1

Scenario: Error handling
  ✗ Trap fired (0%)
  trap: old_v2_api
  reason: Deprecated in Zod 4; use z.treeifyError()
  match: "ZodError.format()"
  cited: [readme], [llms]

-------------------------------------------------------
Overall: 0 / 100 · threshold 80 · run fails
Review fired traps before trusting this surface.
```

## Result Labels

| Label | Meaning |
| ----- | ------- |
| `Well grounded` | Required sources cited. No unknown sources. High confidence. |
| `Grounded` | Required sources cited. No unknown sources. Lower confidence. |
| `Partially grounded` | Some required citations are missing, or unknown citations appeared. |
| `Trap fired` | A declared stale pattern matched. Score is forced to 0 for that scenario. |
| `Ungrounded` | No valid citations, or every citation is unknown. |
| `Error` | The target failed before Pickled could score the response. |

## Sources

Sources are what scenarios cite. Three loader types:

- **`file` (default)** - a path to one local file. The string form (`readme: ./README.md`) implicitly uses this.
- **`url`** - an `http(s)://` path. Fetched on every `pickled check` run.
- **`codebase`** - a glob expanded into one logical source whose content is every matched file concatenated with file-separator headers. Useful when you want the agent to answer from a directory of JSDoc, per-package agent docs, or examples.

Codebase sources are always explicit:

```yaml
docs:
  sources:
    readme: ./README.md                       # file (string form)
    docs_site: https://example.com/docs.md    # url (string form, http prefix)
    jsdoc:
      type: codebase
      path: "packages/**/src/**/*.ts"
      exclude: ["**/*.test.ts"]               # codebase-only
      maxBytes: 524288                        # optional; default 256 KB soft cap
```

Codebase loader safety defaults: skips directories (`onlyFiles`), does not follow symlinks, rejects glob patterns containing `..` segments. Files are read in lexicographic order so the same config produces the same content for reproducible LLM calls. The audit's trap cross-reference scans each matched file individually so findings carry per-file `source_id:path:line`.

URL sources are NOT scanned by the audit's trap cross-reference in v1; they are fetched only during `pickled check`.

## Toolsets

Matrix mode (`scenario.matrix.toolsets`) iterates each scenario across named toolset profiles. Three shapes ship today:

- **`none`** (the deterministic baseline). Pickled injects the cell's active source content into the agent's prompt. Citation contract applies if `requiredSources` is declared. Same scoring shape as non-matrix scenarios.
- **`web`** on Claude Code only. Set `webSearch: true` and/or `webFetch: true`. Maps to `allowedTools: ["WebSearch", "WebFetch"]` on the cell's Claude Code target. Source is NOT injected; the cell's prompt is rewritten to name the active source as the discovery target. Citation contract is skipped; the cell scores on traps + `expected.includes`/`excludes` + tool-use provenance.
- **`mcp`** on Claude Code only. Declare `mcpServers` (a map of server name to `McpServerConfig` with `stdio`, `http`, or `sse` transport). Maps to `allowedTools: ["mcp__<server>__*", ...]` on the cell's Claude Code target so default Read/Edit/Bash do not leak. The configured MCP servers are passed through to the Agent SDK; tool-use provenance accepts any invocation of `mcp__<server>__*` for any configured server.

Tool-use provenance (web and MCP) is a hard veto. A cell that does not invoke at least one of the configured tools is forced to `NO` with confidence `0`, because an answer pulled from model prior knowledge cannot testify to the tool path the cell is meant to test.

Declare profiles at the top level of `pickled.yml`:

```yaml
toolsets:
  none: {}
  web:
    webSearch: true
    webFetch: true
  context7_mcp:
    mcpServers:
      context7:
        type: http
        url: https://mcp.context7.com/mcp
        headers:
          CONTEXT7_API_KEY: ${CONTEXT7_API_KEY}
```

Mixing `webSearch`/`webFetch` and `mcpServers` in the same toolset is rejected: declare separate toolsets so provenance can be attributed to one tool path.

String values in `pickled.yml` that match `${UPPER_SNAKE_CASE}` are replaced with the corresponding `process.env` entry at load time, so secrets (MCP auth headers, API keys) stay out of the config file. Missing env vars become empty strings so the failure surfaces at the call site (e.g., a 401 from the MCP server) rather than at config load. Bun auto-loads `.env`, so the conventional dotfile works.

Then reference them per scenario:

```yaml
scenarios:
  - name: "Install"
    matrix:
      interfaces: [quick]
      sources: [llms]
      toolsets: [none, web, context7_mcp]
    expected:
      includes: ["bunx pickled"]
```

That scenario produces 3 cells: `[quick · llms · none]` (injected), `[quick · llms · web]` (discovered via web tools), `[quick · llms · context7_mcp]` (discovered via Context7 MCP).

Toolsets that declare neither web flags nor `mcpServers`, and toolsets on a non-Claude-Code interface, throw clear errors per cell so the misconfiguration is obvious.

## Targets

Pickled ships three target shapes today. Each target is a distinct surface that exercises the agent differently; results are comparable but not identical.

### CLI targets

- `claude-code` (Claude Agent SDK) - runs the model with tools and workspace context. Requires the Claude Code CLI install.
- `codex-cli` (Codex CLI binary) - spawns the codex binary, pipes the prompt, parses the response.

### API target

- `anthropic` - calls the Anthropic Messages API directly via `@anthropic-ai/sdk`. No tools, no workspace, no agent orchestration. Useful when you want a controlled baseline that isolates "did the model understand the registered sources" from "did the agent's tools fix it for the model."

API targets require:

- `ANTHROPIC_API_KEY` in the environment
- An explicit `model` field on the target config (no silent defaults; reproducibility depends on pinning)

Example config:

```yaml
targets:
  anthropic_haiku:
    category: api
    provider: anthropic
    model: claude-haiku-4-5
    temperature: 0
    maxTokens: 4096
```

API targets accept only `model`, `temperature`, `maxTokens`, and `threshold`. The loader rejects CLI-only fields (`allowedTools`, `mcpServers`, `permissionMode`, `maxTurns`, etc.) on an API target so silent no-ops cannot create false confidence.

**Cost note:** API targets meter by input + output tokens, not by CLI session. Budget accordingly when running matrices with many sources or large scenario sets.

## CI

```yaml
# GitHub Actions
- name: Check agent legibility
  run: pickled check --threshold 80
```

Fail the run when the overall score falls below the threshold.

## Local Development

```bash
# From the monorepo root
bun install
bun run dev:cli -- init
bun run dev:cli -- check
```
