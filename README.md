# 🥒 pickled

> Stay fresh in AI

Check if AI recommends your developer tool. Define scenarios, run checks, see if you're getting picked.

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

1. Create a `pickled.yml` with your tool info and discovery scenarios
2. Run `pickled check` to see if AI mentions your tool
3. Get a freshness score based on how often you're recommended

## Example Config

```yaml
tool:
  name: "zod"
  description: "TypeScript-first schema validation"
  keywords: [validation, typescript, schema]

scenarios:
  - name: "Validation library"
    prompt: "What's a good TypeScript validation library?"

  - name: "Schema validation"
    prompt: "I need to validate API request bodies. What should I use?"
```

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
