# Build mode: a context acceptance test for agent-facing products

State file for a multi-PR, multi-session effort. Update as slices land.

## What Pickled is (the framing this all serves)

Pickled tests *your published context*, using agents as the measuring
instrument. A failing cell is not "the agent is bad"; it is "our docs /
examples / llms.txt / MCP did not let a capable agent succeed." The product
answers, for the intents a company cares about:

> Can an agent answer and build with your product from the context you
> publish, and which context path made the difference?

Two depths of the same question:

- **Answer tasks** (cheap smoke tests): can the agent explain the right API,
  install path, concept, limitation?
- **Build tasks** (the proof): can the agent use that understanding to make a
  real project pass the commands a developer already trusts?

The deliverable is a **diagnosis**, not a single score. Across `access` paths
it sorts failures into four buckets:

1. **Context gap** - injected docs fail.
2. **Discovery gap** - injected docs pass, web/MCP fails.
3. **Agent-surface gap** - one agent succeeds, another fails at the same access.
4. **Environment/test gap** - setup fails or the verifier is flaky.

It is not "prove agents can do everything." It is an **agent-legibility test
suite** for the intents that matter, grown from support issues, real agent
failures, common integrations, and public API surface.

## The unit is a `task` (public `kind: answer | build`)

`questions` becomes `tasks` when the feature ships. `kind` selects the runner.
("Implement mode" stays the internal engineering term; `build` is the public
word, matching `pickled build`.)

Answer task:

```yaml
tasks:
  - id: install
    kind: answer
    prompt: How do I install my-product?
    agents: [quick]
    access: [memory, given_llms]
    checks:
      mustMention: ["bunx my-product"]
```

Build task (v1 public surface - intentionally minimal):

```yaml
tasks:
  - id: custom_toolbar
    kind: build
    prompt: Add a custom React toolbar using my-product.
    agents: [claude_builder]      # edit-capable only
    access: [memory, given_llms, web_llms]
    trials: 3                     # optional, default 1
    workspace:
      path: ./fixtures/react-app
      setup:
        - bun install --frozen-lockfile
    verify:
      - bun test
      - bun run typecheck
```

The build contract is `verify` (the commands a developer trusts), NOT a diff
DSL. Users never write `mustChange` / `mustContain` / `mustAdd`. They write a
small project, its setup, and the commands that prove the work.

## Locked decisions (with why)

1. **`verify` is the build contract.** Real commands, the same bar a developer
   trusts. No user-authored diff-scoring language - that forces authors to
   predict the implementation and turns Pickled into a static-analysis DSL.
2. **Diffs are receipts, not knobs.** Pickled always captures changed files,
   full diff, stdout/stderr, and command exits for the report. None of it is a
   user-facing scoring field.
3. **Empty diff = NO.** A cell where the agent changed nothing is vetoed; no
   work happened. (Receipt-based, structural.)
4. **Setup failure = Error, excluded from scoring.** `workspace.setup` failing
   is environment failure, not agent failure. Only `verify` failures count
   against the agent.
5. **Build cells carry an additive `build` block** (`attempts[]`,
   `passedAttempts / totalAttempts`); the reporter shows `k/n`. Answer cells are
   untouched - NOT reshaped to 1/1 - and keep `answerable`/`confidence`, which
   still drives summary math and thresholds. `trials` optional, default 1. Build
   outcomes are stochastic, so the trustworthy unit is a **repeatable rate per
   access path**, not a single pass/fail. This is the core output, not polish.
6. **Build is CLI-only in v1.** claude-code + codex (edit-capable). API
   providers excluded (no repo-edit loop). Agents must be explicitly granted
   edit capability (`allowEdits`, PR 3); `kind: build` on a non-edit-capable
   agent fails the gate. `agents` stays a list for build too (comparing which
   agent succeeds with your context is part of the diagnosis).
7. **`pickled build` vs `pickled check`.** Build executes code and edits
   workspaces, so it never happens by accident through the answer command.
   `check` runs answer tasks and skips build with a one-line notice; `build`
   runs build tasks.

### Build runner verdict contract (confirmed - runner invariants, NOT public schema)

These are runner invariants, like the web/MCP provenance veto - never public
knobs. Authors write only `workspace` + `verify`. A build attempt scores:

- `setup` fails -> **Error** (environment; excluded from scoring).
- `verify` already passes on the untouched fixture (preflight, after setup,
  before the agent) -> **Error / invalid fixture** (the fixture is bad, not the
  agent; excluded from scoring). Never scored as agent NO.
- agent's diff is empty -> **NO** (no work).
- agent modified or deleted a baseline test file (`tests/**`, `**/*.test.*`,
  `**/*.spec.*`) -> **NO** (weakened the harness). Test files ONLY in v1: do
  not protect config / `package.json` / tsconfig / vite (legitimate fixes touch
  them; protecting them manufactures false failures). Report the changed path;
  a configurable `protect` is deferred.
- `verify` fails after the agent -> **NO**.
- `verify` passes with a real diff and an intact harness -> **pass** attempt.

Powered by the PR 2 primitives: `captureDiff` (empty-diff + the test-file
veto via `checkDiff`), `runCommands` (the preflight and the real `verify`).

## Deferred (NOT in v1 public schema)

`protect` knob, declared golden fixtures, `mustChange`/`mustContain`/etc.,
top-level `workspaces` registry, stdout/stderr `contains`, artifact checks,
browser checks, per-command timeout (unless needed internally), retries beyond
`trials`. Keep the internal engine ready; expose only when a real user need
forces the shape. Discipline: simple schema, strong receipts, room to grow.

## PR sequence (internal-first, breaking-last)

- [x] **PR 1 - refactor, no release (merged #47).** Extract the planner into
  `planner.ts`; both modes share it.
- [x] **PR 2 - chore, no release (merged #48).** Internal primitives:
  `implement/workspace.ts` (copy, setup/`SetupError`, baseline, diff capture,
  cleanup, `runProcess` with bounded-drain timeout) and `implement/verifiers.ts`
  (`runCommands`, `checkDiff`). 19 tests.
- [x] **PR 3 - chore, merged #49.** Edit-capable target capability + gate.
  `isEditCapable` (CLI claude-code/codex; API rejected). Internal `editMode`
  RunOption (NOT public). claude-code editMode: workspace toolset (Read, Glob,
  Grep, Edit, MultiEdit, Write, Bash) + `permissionMode: bypassPermissions`,
  scoped to build + the temp workspace + after gating; extract a pure
  `buildAgentOptions` so the profile is testable without the SDK. codex
  editMode: `--sandbox workspace-write`. setup/verify are run by Pickled, never
  the agent. Public schema (PR 6) exposes `allowEdits` (build-capable), not
  permission semantics.
- [ ] **PR 4 - chore (internal).** Attempts-shaped result model (`attempts[]`,
  `passedAttempts/totalAttempts`); reporter renders `k/n`; answer mode is n=1.
- [ ] **PR 5a - chore (internal).** Extract `resolveCellRuntime` (target config,
  source injection, tool scoping, provenance matcher) from `runMatrixScenario`
  into `cell-runtime.ts`, shared by both runners. Add `taskKind` on CellResult.
  Behavior-preserving except one intentional fix: server-web provenance veto
  names `web_search` (semantic expectedLabels), not `none of []`.
- [ ] **PR 5b - chore (internal).** Build runner orchestrating the primitives:
  create -> setup (Error) -> baseline -> vacuous-fixture guard -> run
  edit-capable target -> capture diff -> empty-diff veto -> harness-protection
  veto -> run `verify` -> record attempt -> cleanup. Tested with fake/editing
  targets. `checkDiff` repositioned to power empty-diff + harness protection,
  not public scoring.
- [ ] **PR 6 - feat -> RELEASE (the breaking PR).** Public schema
  `questions -> tasks` + `kind` + `workspace`/`verify`/`trials`; wire answer +
  build runners onto the shared planner; `pickled build` + gate; migrate the
  dogfood config.
- [ ] **PR 7 - feat.** Reporting: `k/n` by access path + the four-bucket
  diagnosis + receipts (diff, changed files, command logs, kept-workspace path).
- [ ] **Later.** `pickled test` fixture validation (golden passes / empty fails
  / verify stable); docs, schema, examples; then dogfood decides whether
  `protect`, golden fixtures, or richer verifiers earn public schema.

## The clean product model

- **sources** - what truth exists.
- **access** - how the agent reaches it (the diagnosis axis).
- **agents** - who attempts the task.
- **tasks** - what a real developer would ask (answer or build).
- **checks** (answer) / **verify** (build) - what proves success.

## Verified seams (as of 2026-06-02)

- codex read-only today: `targets/cli/codex.ts:85` (`--sandbox read-only`).
- claude-code disallows edits: `config/src/defaults.ts:15`.
- planner extracted: `core/src/planner.ts`. Primitives: `core/src/implement/`.
- `runCommands` IS the `verify` engine; `captureDiff` is evidence + the
  empty-diff signal; `checkDiff` is internal (empty-diff / harness protection),
  not public authoring.

## Open risks

- Stochastic build outcomes -> rate-shaped `k/n`, trials, small/fast/pinned
  fixtures.
- Trust: weak tests pass bad work, agents game tests -> the two safeguards
  above; deterministic fixture tests.
- Cost: `tasks x agents x access x trials` is super-linear -> `--max-cells`
  counts trials; `--plan` shows the expanded total before any build runs.
- Security: temp copy is work-area scoping, not isolation; containers gated on
  hosted/untrusted/unattended use.
- Build-mode access attribution is weaker than answer mode: the agent has Bash
  (can reach the network), so a `web`/`mcp` build cell cannot prove context was
  reached only through that path. Acceptable for v1; do not overclaim build
  provenance the way answer-mode attribution can.
