# Proposal: `anyOf` citation semantics

**Status:** draft, no implementation
**Motivated by:** dogfood runs where the same canonical answer lived in multiple registered sources and citation scoring spuriously flaked
**Decision needed:** schema shape, JSON output shape, brand guidance for when to use

## Problem

`pickled.yml` currently treats `requiredSources` as an AND-list. Every listed source must be cited or the scenario goes PARTIAL/NO. That contract is clean and deterministic, but it cannot express "any authoritative source in this set is acceptable."

Concretely, pickled's own dogfood surfaced two cases where the same answer is intentionally documented across multiple agent surfaces (README + apps/cli/README.md for CLI usage; brand.md + llms.txt for the JSON contract). Citation scoring flipped ~30-50% based on which surface the agent happened to read first. The flake was not a model failure; it was a config-vs-architecture mismatch.

We fixed the dogfood by anchoring each scenario's prompt to one canonical source. That works, but it narrows the test: real users ask unanchored questions. The product needs a citation contract that matches "any of these authoritative sources is acceptable evidence" without inviting weak-test gaming.

## Current behavior (baseline)

```yaml
scenarios:
  - name: Basic usage
    prompt: How do I run pickled to check my project?
    requiredSources: [readme, cli_readme]
```

Semantics today: BOTH `readme` AND `cli_readme` must be cited. Stricter, not more permissive.

## Proposed schema

Two modes, both optional, combinable:

```yaml
requiredSources:
  all: [brand]                      # AND: every source must be cited
  anyOf:                            # AND across groups, OR within each group
    - [readme, cli_readme]          # cite at least one of these
    - [llms, docs]                  # cite at least one of these
```

**Semantics:**

- `all`: every source in the list must be cited. Same as today's bare-list behavior.
- `anyOf`: a list of groups. At least one source from each group must be cited.
- The two are combined by AND. `all` constraints AND each `anyOf` group constraint must be satisfied.

**Backward compatibility:** bare-list form keeps working.

```yaml
requiredSources: [readme]
# is equivalent to
requiredSources:
  all: [readme]
```

## Examples

**Same as today (single required source):**

```yaml
requiredSources: [brand]
```

**Same as today (multiple required, all must cite):**

```yaml
requiredSources:
  all: [brand, agents]
```

**New: one canonical contract source + any user-facing surface:**

```yaml
requiredSources:
  all: [brand]
  anyOf:
    - [readme, cli_readme]
```

**New: any of two equivalent surfaces, no other required source:**

```yaml
requiredSources:
  anyOf:
    - [readme, cli_readme]
```

## What does NOT change

- Source existence: every source named (in `all` or any `anyOf` group) must be declared in `docs.sources` and resolvable on disk. Schema validation runs first; if a source file is missing, the config fails to load. The citation contract is orthogonal to source registration.
- Traps: a trap firing still forces `answerable: NO` and `confidence: 0`, regardless of whether citation constraints were satisfied. Trap evaluation is orthogonal to the new citation modes.
- Scoring: per-scenario `answerable` and `confidence` are derived from the citation contract being satisfied (or not). The aggregate score math (`YES = confidence`, `PARTIAL = confidence * 0.5`, `NO = 0`, averaged across scenarios) is unchanged.

## JSON output shape (open)

The current JSON exposes `cited`, `required`, `missing`, `unknown`. With `anyOf` groups, `missing` becomes ambiguous: if `cli_readme` satisfied a `[readme, cli_readme]` group, is `readme` missing? It was acceptable but not required.

Proposed: expose the contract structure explicitly so consumers can reproduce the satisfied/unsatisfied decision.

```json
{
  "citations": {
    "cited": ["brand", "cli_readme"],
    "unknown": [],
    "contract": {
      "all": {
        "sources": ["brand"],
        "satisfied": true
      },
      "anyOf": [
        {
          "sources": ["readme", "cli_readme"],
          "satisfiedBy": ["cli_readme"]
        }
      ]
    }
  }
}
```

The flat `required` and `missing` fields could be derived for backward compatibility, but the structured `contract` is the source of truth.

## Brand guidance

`anyOf` can become a way to make weak tests pass. Use it deliberately:

- **Use `anyOf` when** the same answer is intentionally documented across multiple authoritative surfaces (e.g., README + CLI README both cover install; brand.md + llms.txt both state the JSON contract).
- **Use `all` when** the scenario requires distinct facts from distinct sources (e.g., a scenario testing the full router pattern might require both `agents` and the brand source it points at).
- **Do not use `anyOf` to suppress flake on under-anchored prompts.** If a scenario flakes because the prompt is too vague, fix the prompt; don't widen the citation contract.

## Explicitly out of scope

- `oneOf` (exactly one citation from the group). No real product use case; two valid citations is usually better evidence, not failure.
- Nested `anyOf` (groups of groups). The two-level shape (`all` + flat `anyOf` groups) covers every dogfood case we've hit. Nested forms would add schema complexity without proven need.
- Weight per source ("brand counts more than llms"). Citation grounding is binary per source today; weighting introduces subjective scoring that the brand explicitly rejects ("scoring is deterministic by contract").

## Implementation order (when work begins)

1. Schema: extend `Scenario.requiredSources` to accept the bare-list, `{all}`, `{anyOf}`, or `{all, anyOf}` shapes.
2. Loader: normalize all shapes to the canonical `{all, anyOf}` form internally.
3. Scorer: replace the all-or-nothing check with the two-mode evaluator.
4. JSON output: add the structured `contract` field; keep `cited` / `unknown` as-is.
5. Reporter: render the contract status in terminal and markdown output. Decide: do we show satisfied groups, or only failures?
6. Tests: cover bare-list, `all`-only, `anyOf`-only, combined, and the edge cases (empty groups, single-source groups, source absent from `docs.sources`).
7. Brand.md update: fold the brand guidance into the Source contract section.

## Open questions for review

1. Field name: `anyOf` (JSON-Schema-style) vs `anyOfGroups` (more literal). Lean `anyOf` if we document precisely.
2. JSON shape: structured `contract` field as proposed, or extend the existing flat `required` / `missing` to be group-aware (less invasive, more cryptic).
3. Reporter output: render passing groups? Or only render anyOf groups when something fails? Latter is quieter; former is more informative.
4. Order of operations: should `anyOf` ship before or after the next CLI release tag? Probably after stabilization; this changes the JSON contract for downstream parsers.
