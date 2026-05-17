# 🥒 pickled

> Agent legibility checker for developer tools

Pickled measures whether AI agents can correctly answer questions about your tool, grounded in your documentation. Every answer must cite a registered source. Citations are extracted and checked deterministically — no self-grading.

## Install

```bash
bun add -g @pickled-dev/cli
```

## Quick start

```bash
pickled init        # writes pickled.yml
pickled audit       # static scan of agent-context files (no LLM)
pickled check       # run scenarios against an agent
```

## How scoring works

1. You declare named sources in `pickled.yml` under `docs.sources`.
2. Each scenario declares which source IDs the answer must cite via `requiredSources`.
3. The agent is given the sources inline and asked to end its response with a `## Sources` section listing the IDs it actually used: `- [readme] short note`.
4. Pickled parses the section, then scores:
   - **YES** — all required IDs cited, no unknown IDs invented.
   - **PARTIAL** — required IDs cited but some missing, or unknown IDs present.
   - **NO** — no citations, or every citation is an invented ID.

Citation grounding is necessary but not sufficient: a stale source produces a confidently grounded answer that's still wrong. Catching that is the job of trap scenarios (coming in M2).

## Example config

```yaml
tool:
  name: zod
  description: TypeScript-first schema validation

docs:
  sources:
    readme: ./README.md
    llms: https://zod.dev/llms.txt

scenarios:
  - name: Installation
    prompt: How do I install zod?
    requiredSources: [readme]

  - name: Basic parsing
    prompt: How do I parse and validate a string with zod?
    requiredSources: [readme]

  - name: Error handling
    prompt: How do I get error messages from failed validation?
    requiredSources: [readme, llms]

# Optional: fail CI if overall score below threshold
threshold: 80
```

## Commands

### `pickled audit [path]`

Static scan of `CLAUDE.md`, `AGENTS.md`, `llms.txt`, `.claude/rules/*.md`. No LLM calls. Reports broken `@`-imports, broken path references, unresolved package-manager commands, oversized sections, and divergent `AGENTS.md`/`CLAUDE.md` pairs.

```bash
pickled audit                     # markdown report to stdout
pickled audit --json              # machine-readable output
pickled audit --fail-on warning   # exit non-zero on any finding
```

### `pickled check [path]`

Runs each scenario against the configured agent target, scores citations, prints a per-scenario report.

```bash
pickled check               # human-readable
pickled check --json        # JSON (source content omitted by default)
pickled check --verbose     # include full source content + transcripts in JSON
pickled check -t 80         # override threshold
```

## Project structure

```
pickled/
├── apps/
│   ├── cli/     # CLI entry point
│   └── web/     # Landing page (placeholder)
└── packages/
    ├── config/  # Schema types + loader
    └── core/    # Audit, sources, scorers, targets, check
```

## Development

```bash
bun install
bun test
bun run lint
```

## Status

Early. M0 (audit) and M1 (citation-based check) shipped. M2 will add trap scenarios for catching stale-but-grounded answers. M3 adds a Codex target. M4 makes context ablation a default.

## License

MIT
