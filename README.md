# 🥒 pickled

> Stay fresh in AI

Pickled helps your developer tool get discovered and recommended correctly by AI. Run a quick check to see how visible you are compared to competitors - and where you're in a pickle.

## What's Inside

```
pickled/
├── apps/
│   ├── cli/     # The CLI tool
│   └── web/     # Landing page
└── packages/
    └── core/    # Shared analysis logic
```

## Quick Start

**Prerequisites**: [Bun](https://bun.sh) v1.0+

```bash
# Install dependencies
bun install

# Check your visibility
bun run dev:cli check github.com/your-org/your-tool
```

## Development

```bash
bun install          # Install dependencies
bun run dev:cli      # Run the CLI
bun run dev:web      # Start the web app
bun test             # Run tests
bun run lint         # Check code style
```

## License

MIT
