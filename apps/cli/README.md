# @pickled-dev/cli

> Stay fresh in AI 🥒

Check if AI recommends your developer tool. Point it at your project, define some discovery scenarios, and see if you're getting picked.

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
  keywords:
    - keyword1
    - keyword2

scenarios:
  - name: "General discovery"
    prompt: "What's a good library for [your use case]?"

  - name: "Specific feature"
    prompt: "I need a tool that can [specific feature]. What should I use?"
```

### 2. Edit your config

Update `pickled.yml` with your actual tool info and scenarios that developers might ask.

### 3. Run check

```bash
pickled check
```

## Commands

### `pickled init [path]`

Create a starter `pickled.yml` config file.

### `pickled check [path]`

Run discovery scenarios and report results.

| Option                | Description            |
| --------------------- | ---------------------- |
| `--json`              | Output as JSON         |
| `-o, --output <file>` | Save report to file    |
| `-v, --verbose`       | Show detailed progress |

## Example Output

```
🥒 pickled check results
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Tool: zod
Path: /path/to/zod

  ✓ "Validation library" - passed
  ✓ "Schema validation" - passed
  ✗ "Form validation" - tool not mentioned

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Freshness: 2/3 (67%) 🥒🥒🥒░░

🥒 Not bad, but room to get fresher.
```

## Config Reference

```yaml
tool:
  name: "tool-name" # Required: your tool's name
  description: "description" # Required: what it does
  keywords: # Required: relevant keywords
    - keyword1
    - keyword2

scenarios: # Required: discovery scenarios
  - name: "Scenario name" # Display name
    prompt: "The question" # What to ask AI

runner: # Optional: customize AI runner
  model: claude-sonnet-4-20250514
  maxTurns: 3
```

## Local Development

```bash
# From the monorepo root
bun install
bun run dev:cli -- init
bun run dev:cli -- check
```
