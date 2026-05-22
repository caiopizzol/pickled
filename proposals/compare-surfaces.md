# Proposal: compare-surfaces analysis mode

**Status:** draft, no implementation
**Motivated by:** the audit cross-reference rule (`cli-v0.10.0`) catches stale claims in registered sources. The next product question is one step deeper: when an agent answers a scenario, *which registered source taught it the wrong thing?* Today pickled scores a scenario once per target with all sources visible. There is no way to say "the agent got the install command wrong, and it was the README that mis-led it, not llms.txt."
**Decision needed:** scenario-level declaration shape, interaction with `requiredSources`, scoring semantics per surface, JSON output shape, renderer changes.

## Problem

Pickled today runs one scenario against one agent target with all registered sources loaded. The output is a single verdict per scenario. The trap engine catches stale claims in agent responses, and the audit cross-reference (shipped) catches stale claims in source contents. Neither answers the attribution question: *given that the agent answered correctly (or wrongly), which source did the work?*

That attribution is what makes pickled different from another evals framework. Without it, a vendor knows their docs are misleading agents but does not know which surface to fix. With it, the failure report points at one file.

Concretely, in this repo: the "Installation" scenario currently uses `requiredSources: [readme]`. If the README is correct, the scenario passes. If only the CLI README has the install command, the scenario fails because the agent can't cite README correctly. But what if the agent gets the right answer from the CLI README despite not being asked to cite it? Today, that's invisible.

## Proposal

Introduce a `compareSurfaces` field on scenarios. Each entry is a list of source IDs that, when active, constitutes one "surface" the scenario runs against. The scenario runs once per declared surface, producing one verdict per surface. The existing single-run mode keeps working when `compareSurfaces` is absent.

```yaml
scenarios:
  - name: "Installation"
    prompt: "How do I install pickled?"
    requiredSources: [readme]
    compareSurfaces:
      - [readme]
      - [cli_readme]
      - [llms]
      - [readme, cli_readme]
```

Per-surface execution:

1. The agent target receives only the sources in the active surface as context.
2. The trap matcher still runs against the agent response. Trap behavior is global; firing forces NO regardless of which surface was active.
3. Citation scoring is filtered to the active surface (see Decision 2).

The terminal renderer surfaces per-surface verdicts:

```text
Scenario: Installation
  [readme]            ✓ Well grounded (94%)
  [cli_readme]        ⚠ Partially grounded (62%)
  [llms]              ✗ Ungrounded (0%)
  [readme,cli_readme] ✓ Well grounded (98%)
```

That report tells a vendor: the README and CLI README both cover install; llms.txt does not, and the agent cannot answer when only llms.txt is loaded.

## Decision 1: declaration shape

**Recommendation:** scenario-level `compareSurfaces: string[][]`. Reject a CLI flag for the first version.

A CLI flag would let users run any scenario across any surface combination ad-hoc. That sounds flexible but it scatters the comparison decision across invocations rather than encoding it in the test contract. Pickled's strength is the declarative contract. Compare-surfaces should live in `pickled.yml` for the same reason scenarios do: so the comparison is auditable and reproducible.

A flag could be added later (e.g., `--compare-surface readme --compare-surface llms`) once the field shape is stable. Not a v1 concern.

## Decision 2: interaction with `requiredSources`

This is the load-bearing design choice. Three options:

**Option A: surface overrides requiredSources.** When a surface is active, scoring requires citing any source in the active surface. The scenario's declared `requiredSources` is ignored during compare. Simple semantics; loses the scenario's authoring intent.

**Option B: per-surface requiredSources.** Vendors declare a citation contract per surface:

```yaml
compareSurfaces:
  - sources: [readme]
    requires: [readme]
  - sources: [cli_readme]
    requires: [cli_readme]
```

Verbose but explicit. Best for scenarios with strong per-surface contracts.

**Option C: intersection.** The scenario's `requiredSources` is filtered to the intersection with the active surface. If empty, the contract softens to "cite any source in the active surface." If non-empty, those specific sources are still required.

**Recommendation:** Option C. It preserves the scenario's authoring intent when sources overlap, gracefully degrades to "cite anything visible" when they don't, and keeps the declaration shape compact. Option B can be added as a refinement later if vendors find Option C too coarse.

## Decision 3: scoring semantics

Per-surface scoring uses the existing scenario verdict ladder (`YES`, `PARTIAL`, `NO`, `Trap fired`, `Error`). The overall scenario verdict in compare mode is the worst per-surface verdict. The aggregate score (`Overall: X / 100`) averages across all per-surface runs.

Trap behavior is global, not per-surface. A trap fired in any surface forces that surface's verdict to `NO` with confidence 0, and is reported once with the active surface noted. A trap firing in the agent response is a trap fire regardless of which sources were loaded; the source attribution comes from comparing surfaces *that did not fire the trap* vs *those that did*.

## Decision 4: JSON output shape

Extend `ScenarioResult` with an optional `surfaces` array. When `compareSurfaces` is declared, `surfaces` carries one entry per surface; the top-level scenario fields (`answerable`, `confidence`, `response`, `citations`, `traps`) reflect the worst result across surfaces, to keep backward compatibility with downstream parsers.

```jsonc
{
  "scenario": {...},
  "answerable": "NO",
  "confidence": 0,
  "surfaces": [
    {
      "active": ["readme"],
      "answerable": "YES",
      "confidence": 94,
      "citations": {...},
      "traps": {...}
    },
    {
      "active": ["llms"],
      "answerable": "NO",
      "confidence": 0,
      "citations": {...},
      "traps": {...}
    }
  ]
}
```

Existing single-run scenarios omit the `surfaces` field entirely.

## Decision 5: renderer changes

Terminal: print the per-surface block under the scenario header (sketch in the Proposal section above). The existing `getScenarioStatus` helper handles each per-surface verdict; the new code is loop + indentation, not new logic.

Markdown: same structure as terminal, with the per-surface block as a sub-list under the scenario heading.

JSON: structured per Decision 4. The `--verbose` flag continues to emit per-surface `allResponses` arrays.

## What does NOT change

- Existing scenarios without `compareSurfaces` continue to run exactly as today.
- The trap engine and matcher (`packages/core/src/scorers/traps.ts`).
- The citation extraction logic.
- The audit cross-reference rule.
- The agent target adapters.
- The CLI top-level commands.

## Examples

**Same scenario, three surfaces, with intersecting required source:**

```yaml
- name: "Installation"
  prompt: "How do I install pickled?"
  requiredSources: [readme]
  compareSurfaces:
    - [readme]
    - [cli_readme]
    - [readme, cli_readme]
```

Per Decision 2 Option C: surface `[readme]` requires `readme`; surface `[cli_readme]` requires nothing specific (intersection empty), so any citation in the active surface counts; surface `[readme, cli_readme]` requires `readme`.

**Trap fires in one surface, not another:**

A scenario tests whether agents avoid the deprecated `docs.source:` schema. Surface `[readme]` (where the schema was scrubbed) passes. Surface `[stale]` (intentionally contains the deprecated form) fires the trap. The compare output isolates the surface responsible.

## Out of scope

- **Cross-target compare.** Comparing the same scenario across `claude-code` vs `codex-cli` is a separate axis. Today's `matrix.target` field already supports this. Compare-surfaces is the orthogonal axis: same target, different sources.
- **Auto-generated surface lists.** Pickled does not infer surfaces from `docs.sources`. Vendors declare them explicitly.
- **Per-surface thresholds.** Run-pass/fail still uses the global `threshold`. A future refinement could add per-surface thresholds; not a v1 concern.
- **Crawler / multi-page docs.** Compare-surfaces uses the existing file and URL loaders. Crawler support is tracked separately.

## Implementation order

1. Schema: extend `Scenario` in `packages/config/src/types.ts` with `compareSurfaces?: string[][]`.
2. Loader: validate that every source id referenced in `compareSurfaces` exists in `docs.sources`; reject empty surfaces.
3. Runner: when `compareSurfaces` is present, run the scenario once per surface; collect per-surface results.
4. Scorer: implement Decision 2 Option C in citation scoring.
5. Aggregator: produce the worst-result top-level fields plus the per-surface array.
6. Renderers: terminal, markdown, JSON output per Decision 5.
7. Tests: per-surface dispatch, intersection citation contract, trap-fires-only-in-one-surface, no-compare-field backward compat, malformed compareSurfaces rejection.
8. Dogfood: pick one scenario in `pickled.yml` (likely "Installation") and add a `compareSurfaces` block to show the matrix output on real data.

## Open questions

1. **Should the surface key in JSON output be the array of source ids, or a stable string?** Arrays are precise but harder to use as map keys downstream. Recommend a stable string like `"readme+cli_readme"` (sorted, plus-delimited) alongside the array.
2. **Does compare interact with `anyOf` citation semantics** (proposal at `proposals/citation-anyof.md`)? Both touch citation scoring. anyOf changes how citations are evaluated against required sources; compare changes the active source set. They should compose, but the order matters. Mark as a follow-up once both have implementations to validate against.
3. **Cost model.** Compare across N surfaces multiplies the scenario's agent runs by N. The Installation scenario today costs one agent run per target; with 3 surfaces it costs 3. Document this clearly in `apps/cli/README.md` so vendors plan budget.
