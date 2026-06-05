# AGENTS.md

Router for agents working on `pickled`. Keep this file short. Real specs live in the documents this points to.

## What pickled is

An open-source CLI that tests whether AI agents can answer and build with a product. It runs tasks against real agent targets down declared context paths: questions check the answer against a deterministic contract (fact coverage, misstatement rejection, and a tool-use provenance veto on web/mcp contexts), and builds have the agent edit a workspace and pass the declared verify commands. No LLM grades another LLM.

## Where the rules live

- **Voice, brand, product contracts** → [`brand.md`](./brand.md). Read before writing any user-facing copy, CLI output, docs, or release notes.
- **Comments** → [`comment-policy.md`](./comment-policy.md). Read before adding, removing, or rewording comments.
- **Product overview and example config** → [`README.md`](./README.md).
- **CLI usage** → [`apps/cli/README.md`](./apps/cli/README.md).

## Load-bearing invariants

These are the rules new edits most often break. Each lives in a single source of truth; do not paraphrase them here.

1. **Cell verdict vs run verdict.** Two orthogonal axes. Renderers must not conflate them. See `brand.md` §Interface Feedback → Verdict layers.
2. **Cell verdict determines the label family.** Each `(agent × context)` cell scores on its own; a task has no single verdict. A question cell is `YES` only when the scored response fully satisfied the contract; the fully grounded result and fact coverage are detail, never an upgrade of PARTIAL/NO/Error. See `packages/core/src/report-status.ts`.
3. **Run-pass/fail language renders only when a threshold is configured.** Without one, show `Overall: X / 100` and stop. A thresholded run with any errored cell fails. See `report-status.ts` near `runPasses`.
4. **JSON output stays raw.** It carries machine fields (`verdict`, `passRate`, `meanCoverage`, `verifierProof`), not derived human labels. Human labels are derived by the shared `report-status` helpers each renderer consumes. Default JSON is also slim: source content, full answers, transcripts, diffs, and command output require `--verbose`.
5. **Registered source contract.** Only sources declared in `pickled.yml`'s `sources` count. Facts are matched against the agent's answer; the contract is the strength, not the limitation.
6. **A web/mcp context proves the tool path.** When a question reaches a source through `web`/`mcp` tools (not injection), the verdict rests on fact coverage + misstatement rejection plus a tool-use provenance veto: a cell that answered without invoking the configured tool is forced to NO. See `packages/core/src/cell-runtime.ts` (provenance) and `packages/core/src/scorers/index.ts`.

## Runtime and toolchain

- **Runtime:** Bun. The CLI shebang is `#!/usr/bin/env bun`. `Bun.file`, `Bun.write`, `Bun.spawn`, and `Glob` from `"bun"` are used across `packages/core`.
- **CLI build target:** `bun build ... --target bun`. Not Node. See `apps/cli/package.json`.
- **Package manager:** Bun. Use `bun install`, `bun test`, `bun run lint`, `bun run format`.
- **Workspaces:** monorepo with `apps/cli`, `apps/web`, `packages/config`, `packages/core`.
- **Tests:** `bun test` runs across all packages. All tests must pass before merging.
- **Lint/format:** Biome. `bun run lint` should exit 0; `bun run format` auto-fixes.

## Release discipline

A `feat:` or `fix:` commit on `main` whose paths match `apps/cli/**`, `packages/core/**`, or `packages/config/**` triggers a release via semantic-release, which publishes the CLI to npm. Two consequences:

- Bundle partial features into a single `feat:` commit so runtime ships with the schema. A `feat:` commit that lands schema-only forces a misleading release; future cleanup commits are then `chore:` against a public artifact that already claimed the feature.
- The Release job runs `bun run verify` (tests, lint, builds, dogfood audit) before semantic-release. CI runs in parallel for surface signal; verify-in-release is the canonical publishability check. See `.github/workflows/release.yml`.

## Targets (today)

- `claude-code` (Claude Agent SDK)
- `codex-cli` (Codex CLI binary)
- `anthropic` (Anthropic API, direct SDK)
- `openai` (OpenAI Responses API, direct SDK)

API targets call the model directly via the provider SDK. No workspace, no Agent SDK orchestration.

- `anthropic`: supports `memory` and `inject` contexts and the `web` context mode. `web` wires the server-side `web_search` tool (`web_search_20250305`) on `messages.create`. Requires `ANTHROPIC_API_KEY`.
- `openai`: supports `memory` and `inject` contexts, the `web` context mode, and the `mcp` context mode. `web` wires the server-side `web_search` tool on `responses.create`; provenance reads `web_search_call` output items and normalizes them to the provider-agnostic `web_search` name. `mcp` wires one hosted-MCP tool entry per declared server (HTTP only; `stdio` MCP servers are not reachable from the API); provenance reads `mcp_call` output items and normalizes them to `mcp__<server>__<tool>` (same shape the Claude Code adapter emits). Requires `OPENAI_API_KEY`.

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
