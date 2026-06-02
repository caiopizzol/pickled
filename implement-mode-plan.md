# Implement mode: from answer-legibility to build-legibility

State file for a multi-PR, multi-session effort. Update as slices land.

## Objective

Evolve Pickled from "can the agent explain the right thing from this context?"
to "can the agent BUILD the right thing from this context?". The scored
artifact moves from text (today) to a workspace change verified by
deterministic evidence (exit codes, diffs, stdout). The contract is
unchanged: no LLM grades another LLM. The build, the test runner, and the
exit code are the judges.

Value claim the product can finally make: "with this context, this agent
builds this task k/n times, vs j/n without it." That is a causal,
rate-shaped legibility signal, far stronger than "the answer mentioned the
right API."

## Locked decisions (with why)

1. **Rename public `questions` -> `tasks`; discriminator `kind: answer | implement`.**
   "Add a React toolbar" is a task, not a question. Pre-1.0, bundle the
   rename WITH implement mode so the breaking change delivers the feature
   (never a bare rename). Deferring would cost two migrations, not one.
2. **Answer mode behavior is unchanged.** `checks.answer` is today's text
   contract (mustMention / mustMentionOneOf / mustNotMention).
3. **Implement mode = workspace + deterministic verifiers.**
   `checks.diff` (mustChange / mustContain / mustNotContain / mustNotChange)
   and `checks.commands` (name + run, exit 0 = pass). No semantic grading.
4. **"Right API used" is a DIFF check, not a response check.** The final
   summary is too weak; the truth is in the changed files.
5. **Setup failure is `Error`, excluded from scoring.** `workspace.setup`
   (e.g. `bun install`) failing is environment failure, not agent failure.
   Only `checks.commands` failures count against the agent. This protects
   the determinism brand. The setup/commands split is the seam.
6. **Empty or irrelevant diff hard-vetoes to NO** (same tier as the existing
   provenance veto). Green tests on an unchanged repo are not an
   implementation. Wrong-files-but-green is a diagnostic, NOT a veto: do not
   over-constrain how the agent solves it; commands are the truth.
7. **Implement mode is CLI-only in v1.** claude-code (enable Edit/Write/
   MultiEdit) and codex (`--sandbox workspace-write`). API targets excluded
   (no repo-edit loop). Gate hard: implement tasks only run on edit-capable
   agents.
8. **Results are trial-shaped from day one.** A cell is `attempts[]` with a
   `passedAttempts / totalAttempts` summary; reports always show `k/n`.
   `trials` defaults to 1 in v1 (answer mode renders 1/1), but the model is
   rate-shaped so single results are never read as measurements.
9. **Explicit execution boundary.** Implement runs must not happen by
   accident from the same command. Recommend a separate `pickled build`
   command for implement tasks; `pickled check` stays answer-only. (Open for
   confirmation; alternative is an explicit `--implement` flag on check.)
10. **No containers / hosted sandbox in v1.** Self-hosted, operator-authored
    tasks on their own machine = same trust model as running the agent
    themselves. Lean on each agent's NATIVE sandbox (codex workspace-write;
    claude-code tool-allowlist + permission mode). Caveat to document:
    temp-copy is work-area scoping, NOT security isolation (Bash + network
    are live). Containers are gated on the hosted/untrusted/unattended case.
11. **`pickled test` validates implement fixtures offline.** A golden
    implementation passes all verifiers; an empty/no-op diff fails. Same
    pass/fail discipline answer mode already has for `examples`.
12. **Tasks must be small / fast / pinned.** The signal is a rate, rates
    cost trials, and an implement cell is already 10-100x an answer cell.
    Economics force narrow tasks (one feature, fast deterministic tests,
    pinned lockfile). The fixture is the new source-of-truth surface.

## PR sequence (internal-first, breaking-last; all risk in the final PR)

- [x] **PR 1 - refactor, no release (merged #47).** Extract the planner from check.ts into
  `packages/core/src/planner.ts`: `expandMatrix`, `planMatrixCells`,
  `matrixCellPairs`, `plannedCellKey`, `buildPlanReport`, and the
  `PlannedCell` / `ExpandedScenario` types. Both modes will share it.
  Non-breaking; keep all tests green.
- [ ] **PR 2 - feat (internal).** Workspace module: copy fixture to a temp
  dir, run `setup` (failure -> Error), capture diff, cleanup,
  keep-on-failure, timeout. Verifier modules: `diff` and `commands`.
  Internal types only; not wired to the public schema yet.
- [ ] **PR 3 - feat (internal).** Edit-capable target capability:
  answer-capable vs edit-capable distinction; claude-code edit profile
  (enable Edit/Write/MultiEdit); codex `--sandbox workspace-write`. Gate so
  implement only runs on edit-capable agents.
- [ ] **PR 4 - feat (internal).** Attempts-shaped result model:
  `CellResult` -> `cell.attempts[]` with `passedAttempts / totalAttempts`;
  reporter renders `k/n`; answer mode is n=1 with no behavior change.
- [ ] **PR 5 - feat -> RELEASE (the one breaking PR).** Public schema
  `questions` -> `tasks` + `kind` + implement fields (workspace, checks.diff,
  checks.commands, trials); wire answer + implement runners onto the shared
  planner; add `pickled build` + gate; migrate the dogfood `pickled.yml`;
  extend `pickled test` for fixture validation. This release ships implement
  mode.

## Schema shape (target, lands in PR 5)

```yaml
tasks:
  - id: react_toolbar
    kind: implement
    prompt: Add a custom React toolbar using my-product/react.
    agents: [claude_builder]      # edit-capable only
    access: [memory, given_llms, web_llms]
    trials: 3
    workspace:
      path: ./fixtures/react-toolbar
      setup: [bun install --frozen-lockfile]
    checks:
      diff:
        mustChange: ["src/**/*.tsx"]
        mustContain: ["my-product/react"]
        mustNotContain: ["legacyReactAdapter"]
      commands:
        - { name: tests, run: bun test }
        - { name: typecheck, run: bun run typecheck }

  - id: install
    kind: answer
    prompt: How do I install my-product?
    agents: [quick]
    access: [memory, given_llms]
    checks:
      answer:
        mustMention: ["bunx my-product"]
```

## Verified seams (as of 2026-06-02)

- codex is read-only today: `packages/core/src/targets/cli/codex.ts:85` (`--sandbox read-only`).
- claude-code disallows edits: `packages/config/src/defaults.ts:15` (`Edit/MultiEdit/Write/NotebookEdit`); `Bash` is allowed.
- planner pieces live in `packages/core/src/check.ts` (~42-235); `sampling.ts` is already its own module; `--plan/--max-cells/--sample/--seed` exist in `apps/cli/src/index.ts:49-52`.
- scoring is text-only today: `scoreExpected` over the response (`scorers/expected.ts`).

## Open risks to keep visible

- Stochasticity: implement verdicts are noisy; rate-shaped + trials + narrow tasks.
- Environment vs agent failure: setup=Error is the guard.
- Fixture validity: pinned deps, deterministic tests, golden/empty offline check.
- Cost: trials x access x cell-cost; aggressive default sampling for implement.
- Security: temp-copy is not isolation; containers gated on hosted/untrusted.
