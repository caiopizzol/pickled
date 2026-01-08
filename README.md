# 🥒 pickled

> Stay fresh in AI

Test how well AI responds to questions about your developer tool. Define scenarios, run checks, and see your freshness score.

## Quick Start

```bash
# Install
bun add -g @pickled-dev/cli

# Create config
pickled init

# Edit pickled.yml with your tool info and scenarios

# Run check
pickled check
```

## How It Works

1. Create a `pickled.yml` with your tool info and scenarios (questions developers might ask)
2. Run `pickled check` to test if AI can answer correctly
3. Get a freshness score based on AI response quality

## Example Config

```yaml
tool:
  name: "zod"
  description: "TypeScript-first schema validation"

scenarios:
  - name: "Installation"
    prompt: "How do I install zod?"

  - name: "Basic parsing"
    prompt: "How do I parse and validate a string with zod?"

  - name: "Error handling"
    prompt: "How do I get error messages from failed validation?"

threshold: 80 # Fail CI if score < 80%
```

## Freshness Scores

| Score  | Status         | Meaning                  |
| ------ | -------------- | ------------------------ |
| 90%+   | Well preserved | AI nails it              |
| 70-89% | Fresh          | Good, minor gaps         |
| 50-69% | Going stale    | Needs attention          |
| <50%   | Gone sour      | Major documentation gaps |

## Project Structure

```
pickled/
├── apps/
│   ├── cli/     # CLI tool
│   └── web/     # Landing page
└── packages/
    └── core/    # Shared logic
```

## Development

```bash
bun install          # Install dependencies
bun run dev:cli      # Run the CLI
bun run dev:web      # Start the web app
```

## License

MIT
