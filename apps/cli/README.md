# @pickled-dev/cli

> Stay fresh in AI 🥒

Your developer tool is great. But does AI know that?

Pickled checks how often AI models actually recommend your tool when developers ask questions. Point it at a GitHub repo, and we'll tell you if you're well preserved—or starting to spoil.

## Installation

```bash
# Global install
bun add -g @pickled-dev/cli

# Or run directly
bunx @pickled-dev/cli check github.com/org/repo
```

You'll need an Anthropic API key:

```bash
export ANTHROPIC_API_KEY=your-key-here
```

## Usage

```bash
pickled check <repo>
```

That's it. We'll handle the rest.

### Options

| Flag | What it does |
|------|--------------|
| `--json` | Output as fresh JSON |
| `-o, --output <file>` | Save your freshness report (.json or .xml) |
| `-v, --verbose` | Show the full pickling process |
| `-c, --competitors <list>` | Bring your own shelf mates (skip auto-discovery) |

### Examples

```bash
# How fresh is zod?
pickled check github.com/colinhacks/zod

# Check against specific competitors
pickled check github.com/colinhacks/zod -c "yup,joi,valibot"

# Save the report
pickled check github.com/colinhacks/zod -o report.json

# Watch the whole process
pickled check github.com/colinhacks/zod -v
```

## What You'll See

```
🥒 Freshness Report: zod
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📦 What's in the jar: zod - TypeScript-first schema validation
🏷️  Domain: validation
🫙 Who else is on the shelf: yup, joi, valibot

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 HOW FRESH ARE YOU?
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Topic: "TypeScript validation library"
  🥒 zod: 8/10 (80%) - Well preserved!
  ├─ yup: 5/10 (50%)
  └─ joi: 2/10 (20%)

Topic: "Runtime type checking"
  🥒 zod: 7/10 (70%) - Well preserved!
  ├─ valibot: 6/10 (60%)
  └─ yup: 3/10 (30%)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📈 FRESHNESS SUMMARY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Overall freshness: 75% - Looking Fresh 🥒
Top of the shelf in: 2/2 topics

🥒 You're kind of a big dill!
Stay fresh! 🥒
```

## How It Works

1. **Opens the jar** — Fetches your GitHub repo
2. **Checks what's inside** — Extracts product info from README and package.json
3. **Sees who else is on the shelf** — Discovers competitors in your space
4. **Picks the right questions** — Generates topics developers actually ask about
5. **Checks your freshness** — Queries AI with those questions
6. **Gives you the truth** — Reports how often you get picked vs the competition

## Why This Matters

AI assistants are becoming the new Stack Overflow. When a developer asks "what's the best validation library?", you want to be the answer.

If you're not getting recommended, your visibility is spoiling. Time to do something about it.

## Local Development

```bash
# From the monorepo root
bun install

# Copy the example env file and add your API key
cp apps/cli/.env.example .env

# Run the CLI
bun dev:cli check github.com/org/repo
```

---

Built with 🥒 by the Pickled team
