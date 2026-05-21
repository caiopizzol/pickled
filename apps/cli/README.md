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

| Option                | Description                                      |
| --------------------- | ------------------------------------------------ |
| `--json`              | Output as JSON                                   |
| `-o, --output <file>` | Save JSON report to file                         |
| `-v, --verbose`       | Show progress while scenarios run                |
| `-t, --threshold <n>` | Minimum score percent needed to pass             |
| `--target <name>`     | Run only the named target (overrides matrix)     |

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
