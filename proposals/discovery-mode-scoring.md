# Proposal: discovery-mode scoring contract

**Status:** draft, no implementation
**Motivated by:** the v0.15.0 dogfood showed `quick` (Claude Code with tools) and `anthropic_api` (direct API) score identically (93/100) across the entire suite. Both surfaces work in *controlled-source* mode where pickled injects registered sources and the agent answers from them. The DX product thesis is different: when a developer asks an AI assistant about a product, the assistant uses its own discovery tools (web search, web fetch, MCP servers like Context7) to find information. There is no pre-registered source contract; the agent goes out and looks. Today's `scoreCitations` rejects this shape because the agent's "citations" are live URLs and tool outputs, not declared source IDs.
**Decision needed:** scoring formula, schema additions, `requiredSources` interaction, provenance shape, mixed-mode run rollup, verifier semantics (deterministic only, no LLM-judge).

## Problem

Pickled today has one scoring mode: citation grounding against a registered source set. That mode is the right model when the vendor wants to test "does our README/llms.txt/AGENTS.md steer agents correctly?" It is the wrong model when the vendor wants to test "when a developer asks ChatGPT/Claude/Cursor about us, what do they hear?"

Concrete: if a developer asks Claude Code "how do I install pickled?", Claude Code will (a) probably use WebSearch to find a docs page, (b) WebFetch the page, (c) maybe call Context7's `get-library-docs` MCP tool, and (d) compose an answer citing URLs and tool outputs. None of those are in `docs.sources`. Today's scorer would mark this NO ("no citations from registered sources"). That is the wrong verdict; the agent did the right thing, and the question is whether what it *found* was correct.

The product gap: pickled needs a second scoring mode that evaluates "did the agent find the right answer through whatever discovery channels it had access to."

## Proposal

Add an optional `mode` field to scenarios. When omitted, the scenario behaves exactly as today (controlled mode, citation-grounded). When set to `discovery`, a new scoring contract applies.

```yaml
scenarios:
  - name: "Install pickled from public docs"
    mode: discovery
    prompt: "How do I install and run pickled?"
    target: claude_code_web        # target has WebSearch, WebFetch, Context7 enabled
    expected:
      includes:
        - "bunx pickled"
        - "pickled check"
      excludes:
        - "docs.source"
        - "freshness score"
    provenance:
      require:
        - urlDomain: "pickled.dev"
    verifiers:
      sources: [readme, cli_readme, core_src]
    traps:
      - id: deprecated_install
        match: "npm install pickled@beta"
        reason: "Beta channel removed; bunx is the canonical install path."
```

Per the critic, this is a deliberate departure from LLM-judge-style scoring. Every check is deterministic: substring/regex match, provenance fingerprint check, trap veto. Verifier sources surface in the report for human review but are NOT used to automatically judge the agent's answer.

## Decision 1: scoring formula

Discovery-mode score is the percentage of deterministic checks satisfied, with traps as a hard veto. The formula:

1. **Trap firing** → forces `answerable = NO`, `confidence = 0`. Identical to controlled mode. Trap veto is universal across modes per `brand.md` §Interface Feedback.
2. **`expected.includes` checks**: each substring/regex must be present in the agent's response. Score contribution = fraction satisfied × weight.
3. **`expected.excludes` checks**: each substring/regex must be absent. Score contribution = fraction satisfied × weight.
4. **`provenance.require` checks**: each provenance requirement (URL domain, MCP tool name, etc.) must be met. Score contribution = fraction satisfied × weight.
5. **Verifier sources** are NOT scored automatically. They are surfaced in the report as side-by-side text so a human can review whether the agent's claims match what the verifier says.

Final score for the scenario: `Math.round((satisfiedChecks / totalChecks) * 100)`. Discovery scenarios use the existing `YES` / `PARTIAL` / `NO` / `Trap fired` verdict ladder so renderers do not need a new label family:
- All checks pass, no traps → `YES`, score 100
- Some checks pass → `PARTIAL`, score proportional
- Zero checks pass → `NO`, score 0
- Any trap fires → `NO`, score 0 (the trap veto)

This preserves the verdict-layers grammar without introducing a new label family. The category split is "controlled vs discovery"; the verdict ladder is shared.

## Decision 2: `requiredSources` interaction

In discovery mode, `requiredSources` is **optional, not required**. If declared, it acts as it does today: the agent's response must cite those source IDs (which means the registered source must be loadable AND the agent's answer must include a `## Sources` section listing them). If absent, no citation requirement.

Most discovery scenarios will omit `requiredSources` entirely because the agent's "sources" are live URLs/tool outputs, not registered source IDs. Provenance tracking (Decision 4) captures the live ones.

A scenario that declares both `requiredSources` and discovery-mode checks is testing "did the agent find the answer AND cite our registered docs?" That is a valid hybrid case; the scorer applies both contracts.

## Decision 3: schema shape

```typescript
interface Scenario {
  // ... existing fields
  mode?: "controlled" | "discovery";   // default "controlled"
  expected?: {
    includes?: Array<string | { pattern: string; flags?: string }>;
    excludes?: Array<string | { pattern: string; flags?: string }>;
  };
  provenance?: {
    require?: ProvenanceCheck[];
  };
  verifiers?: {
    sources?: string[];   // registered source IDs used for human-side comparison
  };
  // traps[] and requiredSources unchanged
}

type ProvenanceCheck =
  | { urlDomain: string }      // any fetched URL must match this domain
  | { mcpTool: string }        // agent must have called this MCP tool
  | { webSearchTerm: string }; // search must have included this term
```

`expected.includes` and `expected.excludes` accept either string (literal substring) or `{ pattern, flags }` (regex). Same shape and validation rules as traps to keep the loader code consistent.

## Decision 4: provenance shape

Targets capture provenance during the run and return it on `TargetResult`. New optional field:

```typescript
interface TargetResult {
  // ... existing
  provenance?: {
    urlsFetched: string[];       // URLs the agent loaded via WebFetch or native search
    mcpToolsCalled: string[];    // MCP tool names invoked, in order
    webSearchQueries: string[];  // text of any web searches issued
  };
}
```

Per-target capture:

- **Claude Code target**: parse the SDK message stream for `tool_use` blocks. WebFetch tool calls expose the URL; WebSearch exposes the query; MCP tool calls expose the tool name.
- **Anthropic API target with native web_search**: the API response includes citation blocks with URLs (per the API's `web_search_20250305` tool documentation). Capture from there.
- **OpenAI Responses API with web_search**: the response includes a sources/citations array. Capture from there.

Provenance capture is target-specific code that lives in each target adapter. The shape on `TargetResult` is uniform; the scorer treats provenance as flat lists regardless of how the target obtained them.

For controlled-mode scenarios, provenance is captured if available but not scored. It becomes useful diagnostic data in JSON receipts.

## Decision 5: mixed-mode run rollup

The run-level `Overall: X / 100` averages all scenarios regardless of mode. A discovery scenario at score 80 and a controlled scenario at score 100 average to 90, same as if they were both controlled. Each mode produces 0-100; the rollup math is unchanged.

This is the right call because vendors will mix modes in one `pickled.yml` ("test our registered docs AND test what agents discover externally") and need a single Overall they can threshold on. Splitting by mode in the rollup would force vendors to interpret two numbers when they want one.

The report distinguishes per-scenario mode in the renderer (Decision 7) so vendors can read the diff, but the aggregate stays unified.

## Decision 6: verifier semantics (no LLM-judge)

Verifier sources are **shown side-by-side in the report**, not used for automatic scoring. The agent claimed X; verifier source Y contains Z; a human (or downstream tool) compares.

Why: "LLM judges agent answer against another LLM-loaded source" violates pickled's core contract (no LLM grades another LLM, per `brand.md` §Personality and §Tonal Rules). Even the controlled-mode citation scorer is structural, not semantic — it checks the response cites a registered source ID, not that the cited source actually supports the claim.

Discovery mode keeps the same discipline. If a vendor wants automated comparison of agent answer to ground truth, they encode it deterministically:
- The expected `bunx pickled` substring covers "did the agent recommend the right install command."
- The expected `pickled check` substring covers "did the agent mention the right CLI command."
- The excluded `docs.source` substring covers "did the agent avoid a known-removed schema."
- A trap covers known-stale prose patterns.
- The verifier source is *human review only*: the report shows what the README says next to what the agent said. No automated judgment.

This is more work for vendors writing scenarios (they have to encode their expected checks as substrings/regexes/provenance) but it preserves deterministic scoring. Future automation that wants LLM-judge behavior should be a separate, clearly-opt-in proposal.

## Decision 7: renderer

Discovery scenarios render with the same verdict-layers grammar as controlled, plus three new sub-lines that surface the check results:

```text
Scenario: Install pickled from public docs
  [claude_code_web] ✓ Well grounded (92%)
  mode: discovery
  expected:
    includes: 2/2 satisfied
    excludes: 2/2 satisfied (no banned phrases found)
  provenance:
    urls: pickled.dev/docs/install, github.com/caiopizzol/pickled
    tools: WebFetch, WebSearch
    require:
      urlDomain "pickled.dev": satisfied
  verifier (human review):
    readme: "Install with `bunx pickled`"
    agent said: "Install via `bunx pickled` and run `pickled check`"
```

The verifier block is the only non-scoring section; it labels itself "human review" so it is not mistaken for automated grading.

For JSON output, `ScenarioResult` gains an optional `discovery: { expected, excludes, provenance, verifierSamples }` block; the top-level evaluation fields stay populated with the deterministic score.

## What does NOT change

- The trap engine. Trap firing still vetoes any scenario in any mode.
- Controlled-mode scenarios (the default). The citation-grounded scorer is unchanged; existing dogfood keeps passing as-is.
- The audit pipeline. Discovery scenarios still get audited for the same broken-ref / line-budget / trap-cross-reference checks as controlled scenarios.
- Compare-surfaces. Orthogonal axis; can be applied to a controlled scenario or a discovery scenario.
- Targets, run discipline, semantic-release flow.

## Examples

**Pure discovery, no registered source citation:**

```yaml
- name: "Install pickled (discovered via web)"
  mode: discovery
  prompt: "How do I install and run pickled?"
  target: claude_code_web
  expected:
    includes: ["bunx pickled", "pickled check"]
    excludes: ["docs.source", "freshness score"]
  provenance:
    require: [{ urlDomain: "pickled.dev" }]
  verifiers:
    sources: [readme, cli_readme]
```

**Hybrid: discovery checks + registered source must cite:**

```yaml
- name: "Citation contract carries through discovery"
  mode: discovery
  prompt: "How does pickled score citations?"
  target: claude_code_web
  requiredSources: [brand]
  expected:
    includes: ["YES", "PARTIAL", "NO"]
  verifiers:
    sources: [brand]
```

Here the agent must use its tools AND cite our brand.md if it loads it. Both contracts apply.

## Out of scope

- **Tool-enabled targets themselves.** Claude Code already supports `allowedTools` + `mcpServers`; the work to wire a "discovery" target shape is config, not new code. Anthropic API web_search and OpenAI Responses API web_search require new target adapters. Both are separate sub-issues.
- **LLM-judged verification.** Explicitly rejected per Decision 6.
- **Auto-generated expected checks.** Vendors author them. Tooling to suggest expected checks from existing docs is a separate v2 idea.
- **Compare-surfaces × discovery interaction.** Discovery scenarios can be in a `compareSurfaces` list, but the interaction needs its own thought once both ship.
- **Cost/sampling for matrix expansion.** Real concern, separate proposal once the discovery primitives exist.
- **brand.md two-mode update.** Per the critic, write brand updates AFTER the contract exists, not before. Avoids aspirational drift.

## Implementation order

1. Schema: add `mode`, `expected`, `provenance`, `verifiers` to `Scenario`. Loader validation: discovery scenarios must have at least one of `expected`, `provenance`, or `requiredSources`; pure-empty discovery is rejected.
2. Provenance capture on `TargetResult`. Claude Code adapter parses tool_use blocks first; API adapters come with their respective web-tool work.
3. New `scoreDiscovery` function parallel to `scoreCitations`. Returns the same `{answerable, confidence, reason, ...}` shape so the runner can route uniformly.
4. `runScenario` branches on `scenario.mode ?? "controlled"`. Discovery scenarios skip citation scoring and call `scoreDiscovery` instead.
5. Renderer surfaces discovery sub-blocks per Decision 7. JSON gains the `discovery` block.
6. Tests: schema validation, scoring formula on all-pass/partial/all-fail/trap-veto cases, provenance check satisfaction, hybrid mode with `requiredSources` + discovery checks.
7. Dogfood: one discovery scenario in pickled.yml using `quick` (no new target needed yet; Claude Code already has tools). Target: probe "how to install pickled" via the agent's own discovery.
8. After this lands and produces evidence: brand.md update naming the two modes and codifying the verifier-is-human-review rule.

## Open questions

1. **Substring vs regex by default in `expected.includes`?** The proposal accepts both shapes. Whether to lean substring (simpler, more brittle) or regex (more expressive, harder to author correctly) is an authoring-ergonomics question; pick based on vendor feedback once shipped.
2. **Provenance for targets that don't expose URLs cleanly.** Codex CLI's interface may not surface fetched URLs the same way Claude Code does. Discovery mode against Codex may have weaker provenance, which is honest and worth documenting per target.
3. **Verifier source pre-loading cost.** Verifier sources are registered sources; they get fetched at run time (file/URL/codebase). Pre-loading them just to show side-by-side in the report adds I/O. Acceptable; flag if it becomes a hot path.
4. **Run rollup math when discovery scenario fires a trap.** Trap-vetoed discovery scenarios contribute 0 to the average, identical to controlled. Confirm this is the desired behavior (it preserves the "trap is universal veto" invariant).
