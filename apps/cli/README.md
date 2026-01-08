# @pickled-dev/cli

> Stay fresh in AI 🥒

Test how well AI responds to questions about your developer tool. Define scenarios, run checks, and see your freshness score.

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
  name: "your-tool"
  description: "What your tool does"

scenarios:
  - name: "Installation"
    prompt: "How do I install this tool?"

  - name: "Getting started"
    prompt: "How do I set up this tool for my project?"

  - name: "Basic usage"
    prompt: "Show me a basic example of using this tool"
```

### 2. Edit your config

Update `pickled.yml` with your actual tool info and scenarios developers might ask about.

### 3. Run check

```bash
pickled check
```

## Commands

### `pickled init [path]`

Create a starter `pickled.yml` config file.

### `pickled check [path]`

Run freshness checks and report results.

| Option                | Description            |
| --------------------- | ---------------------- |
| `--json`              | Output as JSON         |
| `-o, --output <file>` | Save report to file    |
| `-v, --verbose`       | Show detailed progress |
| `-t, --threshold <n>` | Min score % to pass    |

## Example Output

```
🥒 Freshness Check
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Tool: zod

  [default] ✓ "Installation" - Well preserved (92%)
  [default] ✓ "Basic parsing" - Fresh (85%)
  [default] ⚠ "Error handling" - Going stale (65%)
      Missing: safeParse details

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Freshness Score: 81% 🥒🥒🥒🥒░

🥒 Looking fresh! Your docs are doing well.
```

## Freshness Scores

| Score | Status | Meaning |
|-------|--------|---------|
| 90%+ | Well preserved | AI nails it |
| 70-89% | Fresh | Good, minor gaps |
| 50-69% | Going stale | Needs attention |
| <50% | Gone sour | Major documentation gaps |

## Config Reference

```yaml
tool:
  name: "tool-name"       # Required: your tool's name
  description: "desc"     # Required: what it does

scenarios:                # Required: scenarios to check
  - name: "Scenario name" # Display name
    prompt: "The question" # What to ask AI
    target: target-name   # Optional: specific target

targets:                  # Optional: named targets
  claude-sonnet:
    category: cli
    provider: claude-code
    model: claude-sonnet-4-20250514

threshold: 80             # Optional: min score % to pass
```

## CI/CD Integration

```yaml
# GitHub Actions
- name: Check AI freshness
  run: pickled check --threshold 80
```

Fail the build if AI can't answer questions about your tool correctly.

## Local Development

```bash
# From the monorepo root
bun install
bun run dev:cli -- init
bun run dev:cli -- check
```
