# Proposal: matrix evaluation as the product

**Status:** draft, no implementation. **Supersedes** the conceptual split between "controlled source" and "discovery mode" introduced in earlier proposals. Pickled is one product that runs scenario matrices; controlled and discovery are just particular toolset values (`none` is one cell, `WebSearch+WebFetch` is another, etc.). Earlier proposals stay valid as design records for sub-mechanisms but are not the headline anymore.
**Motivated by:** the v0.15.0 dogfood showed that "pickled tests whether agents read your registered sources correctly" is too narrow to be the actual product. Developers ask AI assistants about products via many interfaces (Codex, Claude Code, Cursor, Windsurf, API direct) with different tool configurations (none, web search, Context7 MCP, Firecrawl). What pickled actually measures is what those agents say across that combinatorial space, where they got the answer from, and whether it matches reality.
**Decision needed:** axis vocabulary, scenario shape, scoring per cell, verifier semantics, render shape, parked work boundary.

## The product, in one sentence

**Pickled runs scenario matrices across interfaces, source surfaces, and toolsets, then checks the answers against reality.**

That sentence is the canonical pitch. Brand updates wait until the schema and dogfood examples match it.

## The matrix

Five axes, named explicitly to avoid the drift the earlier proposals accumulated:

| Axis | What it is | Today's coverage |
|---|---|---|
| **Interface** | Which agent the developer is using | Codex CLI ✓, Claude Code ✓, Anthropic API ✓; OpenAI API, IDEs later |
| **Source surface** | The information about the product the agent could read | URL ✓, file ✓, codebase (glob) ✓; npm page, hosted docs URL ✓ |
| **Toolset** | How the agent reaches content during the run | none ✓ (today's controlled mode = `Tools: none` cell), WebSearch/WebFetch (planned), Context7 MCP (planned), Firecrawl (planned) |
| **Scenario** | The developer question | install, configure, integrate, migrate, debug, API usage |
| **Verifier** | What reality looks like for the deterministic check | codebase (the loader from v0.15.0), CLI `--help`, package metadata, canonical docs, declared traps |

A run executes some subset of `(Interface, Source surface, Toolset, Scenario)` cells, scores each cell against `(Verifier checks + Traps)`, and produces a matrix-shaped report.

## Example cells

Same scenario, same interface, four toolset cells (the user's worked example):

```
Scenario: Install SuperDoc
  Interface: Codex · Source: docs.superdoc.dev · Tools: none           → expected/traps/verifier
  Interface: Codex · Source: docs.superdoc.dev · Tools: WebSearch+WebFetch
  Interface: Codex · Source: docs.superdoc.dev · Tools: Context7 MCP
  Interface: Codex · Source: docs.superdoc.dev · Tools: Firecrawl
```

The differences across cells tell the vendor which discovery path actually works for this question.

## Decision 1: `Tools: none` is a first-class cell, not legacy

When the toolset is `none`, the agent cannot fetch content; pickled must supply or constrain the source somehow. That is *exactly* today's controlled-source mode. Renamed without rewriting:

- Source provided via `docs.sources` (file/URL/codebase) → injected into prompt context.
- Citation contract works as today (`requiredSources`, `## Sources` parsing).
- Trap engine vetoes as today.

This cell is the deterministic baseline. Every tool-enabled cell is compared against it. We should NOT call controlled mode "legacy"; it is the no-tools cell of the same matrix.

## Decision 2: scoring per cell

Universal rules across all cells:
- **Traps veto.** Any declared trap firing forces that cell to `NO` with confidence 0. Unchanged from today.
- **Verdict ladder** stays `YES`/`PARTIAL`/`NO`/`Trap fired`/`Error` per `brand.md` §Verdict layers. No new label families.

Cell-specific rules driven by which cell-config fields are present:
- `requiredSources` declared → citation check applies (controlled-style).
- `expected.includes` / `expected.excludes` declared → deterministic substring/regex checks (discovery-style).
- `provenance.require` declared → fetched URL / MCP tool / search query fingerprint check.
- `verifiers.sources` declared → side-by-side human-review block in the report. **NEVER LLM-judged.**

Per cell, the final score is the percentage of declared checks satisfied. Cells that declare nothing actionable (no requiredSources, no expected, no provenance) fail load-time validation - a cell that scores nothing is not a cell.

## Decision 3: verifier is human review only

The verifier axis (codebase, CLI output, package metadata) provides **side-by-side context for human review**, NOT automated answer grading. The principle from `brand.md` §Personality applies unchanged: no LLM grades another LLM. If vendors want automated comparison, they encode the comparison deterministically: substrings, regexes, provenance fingerprints, traps.

Verifier sources are loaded (via the existing source loaders), surfaced in the report next to the agent's answer, and that is it.

## Decision 4: schema (additive, no removals)

Add on `Scenario`:

```typescript
interface Scenario {
  // ... existing fields stay
  matrix?: {
    interfaces?: string[];     // names of declared targets to run this scenario through
    sources?: string[];        // names of declared docs.sources to swap in per cell
    toolsets?: string[];       // names of declared toolset profiles
  };
  expected?: { includes?: [...], excludes?: [...] };
  provenance?: { require?: [...] };
  verifiers?: { sources?: string[] };
}
```

New top-level config:

```yaml
toolsets:           # NEW: named toolset profiles
  none: {}          # the deterministic baseline
  web:
    webSearch: true
    webFetch: true
  context7:
    mcpServers:
      context7: { ... }
  firecrawl: { ... }
```

The matrix expands `(interfaces × sources × toolsets)` per scenario; each cell becomes one evaluation in the report. The existing `compareSurfaces` mechanism (cli-v0.12.0) becomes the rendering layer for `matrix.sources`. Targets (`interfaces`) already iterate via `matrix.target` today; rename to `matrix.interfaces` in the schema while keeping `matrix.target` as a legacy alias for one release. Toolsets are net-new.

No schema removals required. Everything above is additive.

## Decision 5: render

Per-scenario block in the terminal:

```
Scenario: Install SuperDoc
  [Codex · docs.superdoc.dev · none]      ✓ Well grounded (94%)
  [Codex · docs.superdoc.dev · web]       ⚠ Partially grounded (62%)
  [Codex · docs.superdoc.dev · context7]  ✓ Well grounded (88%)
  [Codex · docs.superdoc.dev · firecrawl] ✗ Trap fired (0%)
    trap: deprecated_install
    match: "npm install superdoc@beta"
```

Reuses the existing `getScenarioStatus` helper. Each cell is one row; the label encodes `(interface · source · tools)`.

JSON gains `cell: { interface, source, toolset }` on each `ScenarioResult`. Compare-surfaces' `surfaces[]` becomes one specific axis of the matrix; the broader matrix output uses the same per-cell shape extended with toolset.

## What this proposal does NOT change

- Released cli-v0.10.0 through cli-v0.15.0 behavior. The matrix model is additive.
- The trap engine.
- The audit pipeline.
- Existing target adapters (Codex, Claude Code, Anthropic API).
- Existing source loaders (file, URL, codebase).
- The verdict-layers grammar.
- The release discipline (proposal first, then implementation, single bundled feat: per shippable surface).

## What this proposal supersedes (as the headline)

- `proposals/discovery-mode-scoring.md` - the `mode: discovery` framing is replaced by the `toolset` axis. The scoring shape from that proposal (deterministic checks + traps + human-review verifier) survives as Decision 2 here.
- `proposals/mcp-resource-source-loader.md` - the controlled MCP resource case stays valid for the `(Source: MCP resource, Tools: none)` cell, but it is no longer the headline. Implementation deferred until matrix scoring exists.
- `proposals/compare-surfaces.md` - the per-cell rendering and source-axis iteration are the relevant bits. The "surfaces[]" output shape generalizes to "cells[]" once toolset is also iterated.

The product mental model is now ONE thing (the matrix), not several modes.

## Parked work (moved to `plan.md`)

Items below were valid as features but are not on the critical path for matrix evaluation:

- MCP-resource-as-source loader (controlled MCP)
- Skill-as-source loader
- Internal comment / JSDoc drift detection
- Public web observation mode
- Audit extensions beyond what CI gates need
- IDE targets (Cursor, Windsurf) - need automation-surface investigation
- Context7 / Firecrawl as toolset implementations (they are listed above as planned toolsets; the actual adapter work is parked until matrix primitives exist)

## Out of scope for this proposal

- Brand rewrite. Wait until the matrix schema + dogfood examples are coherent. (Critic discipline: brand crystallizes the product after the schema, not before.)
- Tool-enabled target implementations themselves. Each toolset adapter (web tools, Context7 MCP, Firecrawl) is its own sub-issue.
- Cost / sampling model for full-matrix runs. Real concern; separate proposal.
- Removal of shipped npm features. Released versions stay; matrix is a major-version inflection.

## Implementation order

1. Schema: add `toolsets` top-level, `matrix.interfaces` / `matrix.toolsets` to scenarios, `expected` / `provenance` / `verifiers` on scenarios. Loader validation rejects empty cells.
2. New scoring path: per-cell scorer that applies trap veto + declared checks. Returns same `{answerable, confidence, reason, ...}` shape so the runner is uniform.
3. Runner: expand cells via `matrix.interfaces × matrix.sources × matrix.toolsets`. Iterate; each cell is one evaluation.
4. Provenance capture on `TargetResult` for tool-enabled cells.
5. Renderer: per-cell rows under the scenario header.
6. Dogfood: replace internal-context scenarios with one external-matrix scenario (Codex + pickled.dev URL + tools: none, then + web, then + context7 once those toolset adapters land).
7. After matrix scoring exists: rewrite `brand.md` and `README.md` around the one-sentence product pitch.
8. Tool-enabled target adapters as separate sub-issues, gated on the schema and scoring landing first.

## Open questions

1. **How does compare-surfaces interact with `matrix.sources`?** Likely they unify - compareSurfaces becomes a synonym for `matrix.sources` with a single-interface, single-toolset implicit. Decide during implementation.
2. **Toolset granularity.** Per-tool flags (`webSearch: true`) vs named profiles (`web: { ... }`). Lean toward named profiles so vendors can swap presets cleanly.
3. **Cell-failure semantics in run rollup.** Mixed cells where some pass and some fail at trap-veto: the rollup score averages across cells (each is a data point). Worth confirming against the existing compare-surfaces math.
4. **Backward compatibility for `matrix.target`.** Keep as alias for `matrix.interfaces` for one minor release, then deprecate.
