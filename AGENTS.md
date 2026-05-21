# AGENTS.md

Router for agents working on `pickled`. Keep this file short. Real specs live in the documents this points to.

## What pickled is

An open-source CLI that tests whether AI agents actually understand a product, by running scenarios against real agent targets, checking that answers cite registered sources, and matching declared traps against the response. Scoring is deterministic by contract. No LLM grades another LLM.

## Where the rules live

- **Voice, brand, interface contracts** → [`brand.md`](./brand.md). Read before writing any user-facing copy, CLI output, docs, or release notes.
- **Comments** → [`comment-policy.md`](./comment-policy.md). Read before adding, removing, or rewording comments.
- **Product overview and example config** → [`README.md`](./README.md).
- **CLI usage** → [`apps/cli/README.md`](./apps/cli/README.md).

## Load-bearing invariants

These are the rules new edits most often break. Each lives in a single source of truth; do not paraphrase them here.

1. **Scenario verdict vs run verdict.** Two orthogonal axes. Renderers must not conflate them. See `brand.md` §Interface Feedback → Verdict layers.
2. **Trap firing forces `answerable = NO` and `confidence = 0`**, regardless of citation grounding. See `check.ts` near the `trapFired` branch and `brand.md` §Interface Feedback.
3. **Scenario verdict determines the label family.** Confidence only refines `YES` into `Well grounded` (≥ 90) or `Grounded` (< 90). Never upgrade PARTIAL, NO, Trap fired, or Error. See `packages/core/src/report-status.ts`.
4. **Run-pass/fail language renders only when a threshold is configured.** Without one, show `Overall: X / 100` and stop. See `reporter.ts` near `formatOverall`.
5. **JSON output stays raw.** It carries machine fields (`answerable`, `confidence`, `traps`, `citations`), not derived human labels. Human labels are derived in each renderer.
6. **Registered source contract.** Only sources declared in `pickled.yml`'s `docs.sources` count for scoring. The contract is the strength, not the limitation.

## Runtime and toolchain

- **Runtime:** Bun. The CLI shebang is `#!/usr/bin/env bun`. `Bun.file`, `Bun.write`, `Bun.spawn`, and `Glob` from `"bun"` are used across `packages/core`.
- **CLI build target:** `bun build ... --target bun`. Not Node. See `apps/cli/package.json`.
- **Package manager:** Bun. Use `bun install`, `bun test`, `bun run lint`, `bun run format`.
- **Workspaces:** monorepo with `apps/cli`, `apps/web`, `packages/config`, `packages/core`.
- **Tests:** `bun test` runs across all packages. All tests must pass before merging.
- **Lint/format:** Biome. `bun run lint` should exit 0; `bun run format` auto-fixes.

## Targets (today)

- `claude-code` (Claude Agent SDK)
- `codex-cli` (Codex CLI binary)

Stubbed and not yet implemented: `gemini-cli`, `amazon-q`. Do not claim they work; do not list them in user-facing present tense.

## Two audiences

Pickled tests two use cases:

1. **External:** vendors testing how outside-world agents understand their published product.
2. **Internal:** engineering teams testing whether their own CLAUDE.md, AGENTS.md, JSDoc, comments, and runbooks steer their own agents correctly.

The internal case is the dogfood case for this repo.

## When a task conflicts with these rules

Surface the conflict before silently choosing one side. Brand contracts and verdict layering exist precisely because earlier code drifted from them.

## What not to do

- Do not re-introduce "freshness score" wording in product surfaces. It survives only as the footer sign-off `Stay fresh.` and in trap test fixtures.
- Do not introduce new pickle emoji 🥒 uses. Established chrome stays: nav logo, footer logo, footer sign-off, file-title marks at the top of `README.md` and `pickled.yml`. The canonical rule lives in `brand.md` Tonal Rule 5.
- Do not use em dashes (`—`). Use hyphens, periods, colons, or parentheses.
- Do not commit `AI-powered`, `unlock`, `seamless`, or `holistic` in any user-facing copy.
- Do not add comments that paraphrase the next line. See `comment-policy.md`.
- Do not write release notes by rephrasing commit messages. The release-notes plugin reads `brand.md` for voice.
