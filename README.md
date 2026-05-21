# 🥒 pickled

> Test what agents actually understand.

Pickled measures whether AI agents can correctly answer questions about your product, grounded in the sources you declare. Every answer must cite a registered source. Citations are extracted and checked deterministically. No LLM grades another LLM.

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
   - **YES**: all required IDs cited, no unknown IDs invented.
   - **PARTIAL**: required IDs cited but some missing, or unknown IDs present.
   - **NO**: no citations, or every citation is an invented ID.

Citation grounding is necessary but not sufficient: a stale source produces a confidently grounded answer that's still wrong. **Traps** catch that: a per-scenario list of deterministic stale-pattern detectors (literal substring or regex). Any trap firing forces the result to NO with confidence 0, regardless of how well the answer was grounded.

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
    traps:
      - id: old_v2_api
        match: "ZodError.format()"
        reason: "Deprecated in Zod 4; use z.treeifyError()"

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

Runs each scenario against the configured agent target, scores citations and traps, prints a per-scenario report.

```bash
pickled check               # human-readable
pickled check --json        # JSON (source content omitted by default)
pickled check --verbose     # include full source content + transcripts in JSON
pickled check -t 80         # override threshold
```

## Targets

Configure one or more agents under `targets:` and use `matrix.target` to run scenarios across them:

```yaml
targets:
  claude:
    category: cli
    provider: claude-code
    model: sonnet
  codex:
    category: cli
    provider: codex-cli
    model: gpt-5.5

matrix:
  target: [claude, codex]
```

**`claude-code`** uses the Claude Agent SDK. Requires `claude` installed and authenticated (or `ANTHROPIC_API_KEY` set). Supports `model`, `maxTurns`, `maxThinkingTokens`, `maxBudgetUsd`, `permissionMode`.

**`codex-cli`** shells out to `codex --ask-for-approval never exec` with `--sandbox read-only --ignore-user-config --ignore-rules --ephemeral --skip-git-repo-check`. Requires `codex` installed and authenticated. `model` is **required** (Codex's default model can change). `maxTurns` is **rejected** at config load (Codex CLI does not support a turn cap).

Caveats for `codex-cli`:

- Model names depend on your auth mode. ChatGPT-account installs use names like `gpt-5.5`, `gpt-5.4`, `gpt-5.3-codex`. Check what your local Codex supports with `codex` and pick model from the menu.
- Codex exits 0 even when the API rejects a request (wrong model name, rate limit). Pickled will score that as ungrounded. Check Codex auth/model before treating low codex-cli scores as a docs problem.
- `--ignore-user-config` and `--ignore-rules` isolate `$CODEX_HOME/config.toml` and execpolicy `.rules`. They do **not** isolate `AGENTS.md` or project-level context the agent picks up from `cwd`.

## Project structure

```
pickled/
├── apps/
│   ├── cli/     # CLI entry point
│   └── web/     # Landing page (placeholder)
└── packages/
    ├── config/  # Schema types + loader
    └── core/    # audit, sources, scorers (citation, traps), targets, check
```

## Development

```bash
bun install
bun test
bun run lint
```

## Status

Early. Shipped: M0 (audit), M1 (citation-based check), M2a (trap scenarios), M3 (Codex CLI target alongside Claude Code, with cross-target matrix). Next: M4 makes context ablation a default of every run.

## License

MIT
