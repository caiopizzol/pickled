# Proposal: implementation-readiness evaluation

**Status:** draft, no implementation. Companion to issue [#19](https://github.com/caiopizzol/pickled/issues/19).
**Supersedes:** nothing. Extends the matrix-evaluation product (see `proposals/matrix-evaluation.md`) with a new scoring substrate aimed at the question pickled does not yet answer.
**Motivated by:** pickled today verifies the **left half** of the agent-DX loop (discovery + comprehension). A user asking the system how to extend their product wants to know whether the agent's understanding is actually actionable. SWE-bench-style closed-loop code execution is one answer; it is also a different product with very different infrastructure cost and a much larger safety story. This proposal carves a middle layer that stays within pickled's deterministic-scoring contract.
**Decision needed:** scenario shape, grouped-check schema, codebase-existence verifier semantics, reporter shape, dogfood subject, correlation-experiment design.

## The product question

> Can the agent take the context pickled already measures it comprehended, and turn it into an actionable implementation plan, before any code is written?

That is the question this proposal answers. It is one layer deeper than "did the agent cite the right doc" and one layer shallower than "did the agent's code pass the test." Call it **implementation-readiness**.

## The loop pickled measures

1. **Discovery** - can the agent find the right source? (today: tool-use provenance on web/mcp cells)
2. **Comprehension** - can it identify the right API, component, option, constraint? (today: `expected.includes` + traps + citation contract)
3. **Transfer** - can it turn that understanding into an actionable implementation plan? **(this proposal)**
4. **Implementation** - can it write code that passes tests? (Layer 2, deferred; see "Decision matrix" below)

## What changes in pickled

Three small additions, each shippable on its own, in this order:

### 1. Grouped expected checks

Today everything goes through `expected.includes` / `expected.excludes`. Group the includes by what kind of comprehension the check is testing, so the reporter can say *what* failed, not just *that* something failed:

```yaml
expected:
  symbols: ["registerToolbarButton", "Editor.update"]
  paths: ["src/editor/toolbar.ts"]
  options: ["icon", "onClick", "tooltip"]
  constraints: ["register command before rendering"]
  excludes: ["oldToolbarApi", "deprecatedRender"]
```

Scoring substrate stays the same (substring match) in v1. The split is presentational: the reporter can surface "symbols 2/2, options 1/3 - agent named the right APIs but missed config." That diagnostic value is real even though the underlying matcher is unchanged.

**Explicit about labels vs semantics.** `constraints` is `expected.includes` with a clearer label. Calling it `constraints` does not buy ordering/dependency/semantic-equivalence checking - that would be a separate scoring substrate (proposal future). Document this honestly in the schema doc-comment so we don't claim more than we score.

**`excludes` stays where it is.** Do not move `excludes` under the grouped keys. The global banned-substring contract is already meaningful and unambiguous. Introducing a separate `expected.antiPatterns` only makes sense once the reporter needs to distinguish "deprecated implementation pattern" from generic banned phrases. Until then, two names for the same thing is worse than one clear name.

**Back-compatible.** Existing `expected.includes` / `expected.excludes` keep working. The new grouped keys are additive. A scenario can use either or both.

### 2. Codebase existence verification

The strongest near-term capability and the genuinely new thing. When the agent's answer names a symbol or path, pickled verifies it exists in the registered `codebase` source:

- **Declared paths**: scenarios that declare `expected.paths: ["src/editor/toolbar.ts"]` get an existence check against the loaded codebase glob. If the path doesn't exist, the cell logs "hallucinated path" alongside the substring miss.
- **Declared symbols**: scenarios that declare `expected.symbols: ["registerToolbarButton"]` get a grep-style existence check in the codebase source. If the symbol doesn't appear in any registered file, the cell logs "hallucinated symbol."

Both run only when the scenario has declared the check AND the registered sources include a `codebase` loader. No auto-extraction from prose in v1 - the vendor declares what should be real; pickled checks that it is.

Deterministic, no LLM-as-judge, extends pickled's existing "registered source contract." Catches a failure mode (API hallucination) that SWE-bench's exit-code oracle does not directly surface.

### 3. Readiness reporter

The actual product value. Auto-surface matrix-diagnosis patterns over the existing per-cell scores. Examples:

- *"Docs failed, codebase passed: this behavior exists in code but is not explained in docs."*
- *"Web failed, injected docs passed: agents cannot discover the right page from search."*
- *"MCP passed, web failed: MCP is carrying better context than public search."*
- *"All sources failed on `<scenario>`: the implementation path is unclear or missing across every surface."*

This is mostly orthogonal to the scenario shape. Could ship as a `pickled report` subcommand on existing matrix output, or as an additional block in the terminal/JSON reporter (likely both). Reuses the `plan.expandedCells` / `plan.selectedCells` infrastructure from #17.

The reporter is what vendors actually pay for. The scenario shape is the input format; the reporter is the diagnosis.

## Dogfood subject

Pickled itself is too simple to stress-test implementation-readiness (small surface area, no deprecation history, no async lifecycle). Pick a product with:

- Real APIs and components
- Deprecated paths that traps can target
- Async / lifecycle constraints
- Examples in both docs and code (so the matrix can compare doc-derived comprehension vs codebase-derived comprehension)

[SuperDoc](https://github.com/Harbour-Enterprises/SuperDoc) fits. Real DX questions, real public docs, real public codebase, real deprecation history. Implementation-readiness scenarios should be authored against SuperDoc's documented toolbar / editor / config surface.

3-5 dogfood scenarios is enough for a first run. They should each declare grouped expected checks AND codebase-existence checks, so both new substrates are exercised.

## Correlation experiment

Before scaling implementation-readiness as a flagship scoring shape, validate the proxy:

1. Pick 10-20 implementation tasks where ground-truth is known. Candidates: SuperDoc historical PRs (the merged code IS the ground truth), SWE-bench-Verified tasks (smaller subset, well-curated), internal fixtures with a hidden test suite.
2. Ask the agent the **implementation-readiness** question first ("which APIs, paths, options, and constraints matter for this task?"). Score with the new substrate.
3. Run the actual implementation separately, **outside pickled** (in the product's own test environment). Capture pass/fail.
4. Plot readiness score vs implementation pass/fail.

Decision matrix:

| Correlation result | Recommended action |
|---|---|
| **High (~0.7+)** | Ship implementation-readiness as flagship. Do NOT build Layer 2 inside pickled. Two-tool story: pickled for readiness + external harness for code-gen verification. Keeps pickled's contract sharp. |
| **Medium (~0.4-0.7)** | Identify what readiness misses (constraints? ordering? semantic equivalence?). Consider Layer 2 as a separate composing tool, not a pickled feature. |
| **Low (<0.4)** | Strong evidence for Layer 2 inside pickled, with explicit sandbox/safety architecture. Open as new issue with the empirical justification. |

The experiment is the gate. Don't ship Layer 2 (or even commit to building it) without it.

## Why not jump straight to Layer 2

Sandboxed code execution is a different product surface:

- **Cost.** 10-100× per cell (sandbox + dependency install + verifier run). The `--max-cells` / `--sample` controls from #17 become load-bearing rather than optional.
- **Safety.** "The agent writes files and pickled runs them" introduces RCE on every runner if `pickled.yml` is ever compromised. Today pickled has none of this exposure. Containerization is not a line item; it's a substantial engineering investment.
- **Authoring cost.** Today's vendor `pickled.yml` is a line per scenario. A Layer-2 `pickled.yml` is closer to a test repo (fixture dir + golden test per scenario). The vendors who happily author 20 substring checks may not author 20 fixtures + 20 tests. Adoption curve fundamentally different.
- **Differentiation diluted.** Comparing "Claude Code web" vs "OpenAI MCP" on substring contracts says something genuinely new. On a code-gen contract, the matrix axis matters less - code is code, and you mostly learn which model is better. SWE-bench already answers that question without the matrix.

Implementation-readiness, if the correlation experiment supports it, captures most of the predictive value at none of these costs.

## Sequence of work

This proposal is the umbrella for issue #19. Concrete next steps, smallest-first:

1. **This proposal file lands** (PR-equivalent: commit + issue update). No implementation.
2. **Grouped expected checks** (small feature). Spec the schema, add to `packages/config/src/types.ts`, extend the scorer, add a reporter line. Tests-first. Released as `feat(scoring):`.
3. **Codebase existence verification** (small feature). Add the existence matcher; wire into the grouped-check pipeline. Tests-first. Released as `feat(scoring):`.
4. **Readiness reporter** (medium feature). The matrix-diagnosis pattern surfacing. Could be its own `pickled report` subcommand. Released as `feat(reporter):`.
5. **SuperDoc dogfood** (research task). 3-5 readiness scenarios against SuperDoc's public surface. Recorded as `proposals/superdoc-readiness-dogfood.md` with the first receipts.
6. **Correlation experiment** (research task). 10-20 tasks, readiness vs implementation pass/fail. Recorded with the data so the Layer 2 decision can be made on evidence.
7. **Layer 2 decision** (no implementation). Based on the experiment outcome, pick the right action from the decision matrix above. Either close the loop here (no Layer 2 inside pickled) or open a fresh issue with the empirical justification.

Each step ships before the next is committed. If step 2 turns out to add no diagnostic value over the existing `expected.includes`, stop there and revisit the proposal.

## Explicitly out of scope

- Sandboxed code execution (Layer 2). Decision deferred to step 7.
- Semantic-grading constraints (ordering, dependency, semantic equivalence). Future work; v1 scoring stays substring-based with clearer labels.
- `--max-cost USD` from #17. Stays parked until real usage data exists.
- `IdeProvider` stub cleanup (#18). Independent track.

## Naming

"Implementation-readiness" is the working name. It is more honest than "code-gen" (no code is run) and more specific than "comprehension" (which pickled already does). The product story for vendors:

> Can agents actually build with your product after reading the same context real developers see?

That is the differentiated pitch. SWE-bench asks "can this agent solve arbitrary GitHub issues?" Pickled asks "can agents use *your* product correctly after seeing *your* docs, codebase, llms.txt, CLAUDE.md, and MCP servers?" The matrix axis (interface × source × toolset) tells the vendor *where* the agent's understanding breaks down. That diagnosis is what the readiness reporter exists to deliver.
