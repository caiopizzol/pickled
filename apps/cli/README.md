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
| `--target <name>`     | Run only the named target (overrides matrix)                        |
| `--scenario <name>`   | Run only the named scenario (CI-matrix-friendly)                    |
| `--interface <name>`  | Matrix cell filter: run only cells with this interface              |
| `--source <name>`     | Matrix cell filter: run only cells with this source id              |
| `--toolset <name>`    | Matrix cell filter: run only cells with this toolset name           |

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
