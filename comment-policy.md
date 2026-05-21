# Comment policy

Core rule: write comments when they encode information the code does not already make obvious. Do not write comments that merely restate the code.

## Write

- Invariants the code does not enforce structurally.
- Non-local constraints that live in another file, package, or document.
- Refactor-sensitive rationale next to code that looks simpler than it is.
- `AIDEV-NOTE:` anchors for rules that must survive future agent edits, with a pointer to the source of truth (usually `brand.md`).

## Do not write

- Comments that paraphrase the next line.
- Generic AI-style docstrings such as "Returns the appropriate value."
- Vague warnings without a named file, symbol, rule, or consequence.
- Historical notes that no longer affect the current code path.

## Prefer specific anchors

Weak:

```ts
// Trap firing affects the score.
```

Strong:

```ts
// AIDEV-NOTE: Trap firing forces answerable to NO and confidence to 0,
// regardless of citation grounding. See brand.md §Interface Feedback →
// Verdict layers. Do not bypass this branch.
```

Strong for non-local rules:

```ts
// AIDEV-NOTE: Scenario verdict determines the label family. Confidence only
// refines YES into Well grounded vs Grounded. Never upgrade PARTIAL, NO,
// Trap fired, or Error. The single source of truth is getScenarioStatus in
// packages/core/src/report-status.ts.
```

## Treat stale comments as bugs

Comments and agent-facing docs are prompt surface. A stale comment is not harmless decoration; it can become an instruction the next agent follows. If a comment no longer reflects the code, update it or delete it in the same change.

## Treat agent-facing docs as comments

`README.md`, `AGENTS.md`, `CLAUDE.md`, `brand.md`, and runbooks are prompt surface too. If a code change invalidates one of these docs, update or delete the stale prose in the same change. A stale root instruction can be more dangerous than a stale inline comment because agents may treat it as project policy.

## When a task conflicts with a comment

Treat the comment as a documented constraint. If the requested change appears to violate it, surface the conflict before silently choosing one side.

## How this is enforced

- `pickled audit` flags broken `@`-imports, oversized agent-doc sections, and AGENTS.md / CLAUDE.md divergence.
- Inline-comment quality is not auto-enforced today. The policy is the contract; the audit catches structural drift.

Adapted from [`comment-bench`](https://github.com/caiopizzol/comment-bench)'s policy.
