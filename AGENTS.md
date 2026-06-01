# AGENTS.md

Router for agents working on `pickled`. Keep this file short. Real specs live in the documents this points to.

## What pickled is

An open-source CLI that tests whether AI agents actually understand a product. It runs questions against real agent targets down declared context paths and checks each answer against a deterministic contract: must-mention, one-of mention, must-not-mention, and tool-use provenance. No LLM grades another LLM.

## Where the rules live

- **Voice, brand, product contracts** → [`brand.md`](./brand.md). Read before writing any user-facing copy, CLI output, docs, or release notes.
- **Comments** → [`comment-policy.md`](./comment-policy.md). Read before adding, removing, or rewording comments.
- **Product overview and example config** → [`README.md`](./README.md).
- **CLI usage** → [`apps/cli/README.md`](./apps/cli/README.md).

## Load-bearing invariants

These are the rules new edits most often break. Each lives in a single source of truth; do not paraphrase them here.

1. **Question verdict vs run verdict.** Two orthogonal axes. Renderers must not conflate them. See `brand.md` §Interface Feedback → Verdict layers.
2. **Question verdict determines the label family.** Confidence only refines `YES` into `Well grounded` (≥ 90) or `Grounded` (< 90). Never upgrade PARTIAL, NO, or Error. See `packages/core/src/report-status.ts`.
3. **Run-pass/fail language renders only when a threshold is configured.** Without one, show `Overall: X / 100` and stop. See `reporter.ts` near `formatOverall`.
4. **JSON output stays raw.** It carries machine fields (`answerable`, `confidence`, `citations`), not derived human labels. Human labels are derived in each renderer.
5. **Registered source contract.** Only sources declared in `pickled.yml`'s `sources` count for scoring. The contract is the strength, not the limitation.
6. **A non-none access path skips citation scoring.** When a question reaches a source through `web`/`mcp` tools (not injection), the verdict rests on the `checks` plus a tool-use provenance veto, not on `## Sources` citations. See `check.ts` near `provenanceFailed`.

## Runtime and toolchain

- **Runtime:** Bun. The CLI shebang is `#!/usr/bin/env bun`. `Bun.file`, `Bun.write`, `Bun.spawn`, and `Glob` from `"bun"` are used across `packages/core`.
- **CLI build target:** `bun build ... --target bun`. Not Node. See `apps/cli/package.json`.
- **Package manager:** Bun. Use `bun install`, `bun test`, `bun run lint`, `bun run format`.
- **Workspaces:** monorepo with `apps/cli`, `apps/web`, `packages/config`, `packages/core`.
- **Tests:** `bun test` runs across all packages. All tests must pass before merging.
- **Lint/format:** Biome. `bun run lint` should exit 0; `bun run format` auto-fixes.

## Release discipline

A `feat:` or `fix:` commit on `main` whose paths match `apps/cli/**` or `packages/core/**` triggers a release via semantic-release, which publishes the CLI to npm. Two consequences:

- Bundle partial features into a single `feat:` commit so runtime ships with the schema. A `feat:` commit that lands schema-only forces a misleading release; future cleanup commits are then `chore:` against a public artifact that already claimed the feature.
- The Release job runs `bun run verify` (tests, lint, builds, dogfood audit) before semantic-release. CI runs in parallel for surface signal; verify-in-release is the canonical publishability check. See `.github/workflows/release.yml`.

## Targets (today)

- `claude-code` (Claude Agent SDK)
- `codex-cli` (Codex CLI binary)
- `anthropic` (Anthropic API, direct SDK)
- `openai` (OpenAI Responses API, direct SDK)

API targets call the model directly via the provider SDK. No workspace, no Agent SDK orchestration.

- `anthropic`: supports the `none` toolset and the `web` toolset. `web` wires the server-side `web_search` tool (`web_search_20250305`) on `messages.create`; `webFetch` has no Anthropic API equivalent and is a no-op on this provider. Requires `ANTHROPIC_API_KEY`.
- `openai`: supports the `none` toolset, the `web` toolset, and the `mcp` toolset. `web` wires the server-side `web_search` tool on `responses.create`; provenance reads `web_search_call` output items and normalizes them to the provider-agnostic `web_search` name. `webFetch` is a no-op on this provider (single server-side web tool). `mcp` wires one hosted-MCP tool entry per declared server (HTTP only; `stdio` MCP servers are not reachable from the API); provenance reads `mcp_call` output items and normalizes them to `mcp__<server>__<tool>` (same shape the Claude Code adapter emits). Requires `OPENAI_API_KEY`.

Both require an explicit `model` field. The loader rejects CLI-only fields (`allowedTools`, `mcpServers`, `permissionMode`, `maxTurns`, etc.) on API targets. Comparable to CLI targets but not identical.

Stubbed and not yet implemented: `amazon-q`, Google API target. Do not claim they work; do not list them in user-facing present tense. `gemini-cli` was removed when Google announced the consumer-tier sunset (2026-06-18) in favor of Antigravity CLI; a future Antigravity adapter will be its own provider.

## Two audiences

Pickled tests two use cases:

1. **External:** vendors testing how outside-world agents understand their published product.
2. **Internal:** engineering teams testing whether their own CLAUDE.md, AGENTS.md, JSDoc, comments, and runbooks steer their own agents correctly.

The internal case is the dogfood case for this repo.

## When a task conflicts with these rules

Surface the conflict before silently choosing one side. Brand contracts and verdict layering exist precisely because earlier code drifted from them.

## What not to do

- Do not re-introduce "freshness score" wording in product surfaces. It survives only as the footer sign-off `Stay fresh.`.
- Do not introduce new pickle emoji 🥒 uses. Established chrome stays: nav logo, footer logo, footer sign-off, file-title marks at the top of `README.md` and `pickled.yml`. The canonical rule lives in `brand.md` Tonal Rule 5.
- Do not use em dashes (`—`). Use hyphens, periods, colons, or parentheses.
- Do not commit `AI-powered`, `unlock`, `seamless`, or `holistic` in any user-facing copy.
- Do not add comments that paraphrase the next line. See `comment-policy.md`.
- Release notes ship deterministically from conventional commit subjects via `@semantic-release/release-notes-generator`. Write commit subjects so they read cleanly as bullet copy. Hand-edit a high-stakes release body with `gh release edit` when needed. Background and restoration plan for AI notes: `plan.md` → Parked: release-notes hardening.
