# SuperDoc readiness dogfood: first receipts

**Status:** first-run receipt. Companion to issue [#23](https://github.com/caiopizzol/pickled/issues/23) and step 5 of [#19](https://github.com/caiopizzol/pickled/issues/19).
**Subject:** [SuperDoc](https://github.com/superdoc-dev/superdoc) - public document editor with hosted docs at `docs.superdoc.dev`.
**Origin:** a Discord user reported their AI coding tool (Codex / Claude Code) gave bad SuperDoc guidance because the Context7-indexed context was poor. SuperDoc has official `llms.txt` + `llms-full.txt` files; the agent apparently did not reach them. This dogfood asks: when does the breakdown actually happen?

## Hypothesis (pre-run)

The Discord report is evidence of one or both failure modes:

1. **Discovery failure** - unhinted agent with web tools does not find the official docs / LLM files; ends up on a worse third-party index.
2. **Source-quality failure** - when given a specific source, the answer quality varies. Context7's index in particular leads with contributor setup, not surface guidance.

Pre-run verification (done before the matrix ran, so the assertions are vendor-truthful):

- `https://docs.superdoc.dev/llms.txt` and `https://docs.superdoc.dev/llms-full.txt` exist; both return 200.
- `https://context7.com/superdoc-dev/superdoc/llms.txt` returns content that opens with `CONTRIBUTING.md` dev-setup, not surface guidance.
- The exported public symbols asserted below (`SuperDocUIProvider`, `useSuperDocUI`) live in `packages/superdoc/src/public/ui-react.ts`. The import subpath (`superdoc/ui/react`) and the `superdoc.activeEditor.commands.*` anti-pattern are named verbatim in `docs.superdoc.dev/llms.txt`; the `createHeadlessToolbar` anti-pattern appears in `llms-full.txt` (the bundle), not the router. Every assertion in the scenario is grounded in one of those public files.
- Independent finding before the run: official `llms-full.txt` claims "180+ MCP tools," the `/ai/mcp/overview` page says "12 tools total." Source drift across SuperDoc's own surfaces. Not part of this scenario but worth a trap declaration in v2.

## Scenario (v1: one scenario, eight cells)

The scenario asks the kind of question the Discord user would have asked. The matrix splits the two failure modes:

```yaml
tool:
  name: "superdoc"
  description: "Document engine for the modern web (.docx-native editor + SDK + MCP)"

docs:
  sources:
    superdoc_llms_full: https://docs.superdoc.dev/llms-full.txt
    superdoc_llms: https://docs.superdoc.dev/llms.txt
    superdoc_context7: https://context7.com/superdoc-dev/superdoc/llms.txt

targets:
  quick:
    category: cli
    provider: claude-code
    model: claude-haiku-4-5
    maxTurns: 5

toolsets:
  none: {}
  web:
    webSearch: true
    webFetch: true

scenarios:
  - name: "Custom React toolbar surface"
    prompt: "I am building with SuperDoc in React and want to add a custom toolbar. Which SuperDoc surface should I use, what should I import, and what should I avoid?"
    matrix:
      interfaces: [quick]
      sources: [none, superdoc_llms_full, superdoc_llms, superdoc_context7]
      toolsets: [none, web]
    expected:
      symbols:
        - "SuperDocUIProvider"
        - "useSuperDocUI"
      paths:
        - "superdoc/ui/react"
      excludes:
        - "createHeadlessToolbar"
        - "activeEditor.commands"
```

8 cells total. One interface (`quick` = Claude Haiku 4.5) to control cost on this first pass.

## Receipts (live run, 2026-05-25)

`pickled check /tmp/superdoc-dogfood`, full JSON receipt at `/tmp/superdoc-dogfood/receipt.json`.

| cell | verdict | conf | symbols | path | excludes hit |
| --- | --- | --- | --- | --- | --- |
| quick · none · none | PARTIAL | 40 | 0/2 | 0/1 | clean |
| quick · none · web | ERROR | 0 | - | - | adapter error: ConnectionRefused (transient infra; not signal) |
| quick · superdoc_llms_full · none | PARTIAL | 40 | 1/2 | 1/1 | **both hit** |
| quick · superdoc_llms_full · web | PARTIAL | 60 | 2/2 | 1/1 | **both hit** |
| quick · superdoc_llms · none | PARTIAL | 40 | 0/2 | 1/1 | `activeEditor.commands` |
| quick · superdoc_llms · web | PARTIAL | 40 | 0/2 | 1/1 | `activeEditor.commands` |
| quick · superdoc_context7 · none | PARTIAL | 40 | 0/2 | 0/1 | clean |
| quick · superdoc_context7 · web | ERROR | 0 | - | - | maxTurns=15 (agent thrashed) |

**Overall:** 16 / 100. Two cells errored on transient infrastructure; the rest were all PARTIAL.

Readiness reporter diagnostics fired:

- `grouped_check_pass` on `[quick · superdoc_llms_full · web]` (symbols 2/2, paths 1/1)
- `source_comparison` × 2: `superdoc_llms_full` answered (PARTIAL) while `none` did not on `[quick · web]`; same for `superdoc_llms`.

## Findings

### 1. Context7's SuperDoc index does not teach the surface

`[quick · superdoc_context7 · none]` PARTIAL 40 - missed both symbols AND the path. Cell with web errored on maxTurns, suggesting the agent thrashed trying to verify the bad context. Confirms the Discord complaint: the Context7-indexed view of SuperDoc opens with `CONTRIBUTING.md` and example install commands, not "use `SuperDocUIProvider` from `superdoc/ui/react`." An agent reading Context7 first won't learn the surface.

Action: this is SuperDoc-and-Context7 territory, not pickled's. Either (a) work with Context7 to improve their index of SuperDoc (use the official llms.txt as source), (b) update SuperDoc's `context7.json` to point at a curated subset, or (c) improve discoverability of `docs.superdoc.dev/llms.txt` so agents reach it before Context7.

### 2. Even with official docs injected, the anti-patterns leak

This is the most actionable SuperDoc finding. `[quick · superdoc_llms_full · web]` got the symbols (2/2) and the path (1/1) right - but the agent's response still mentioned BOTH `createHeadlessToolbar` AND `activeEditor.commands`, even though the very docs it was reading say verbatim:

> **Use for custom React UI**: not `superdoc.activeEditor.commands.*`.

So the agent extracts the right "use" but doesn't honor the "don't use." That's not a docs *absence*; that's a docs *salience* issue. The deprecation is in the docs but not loud enough to override the agent's prior knowledge of those legacy names.

Action: SuperDoc could strengthen the deprecation language in `llms-full.txt` - explicit "DO NOT USE" callouts on `createHeadlessToolbar` and `activeEditor.commands`, ideally near the top where context budget hasn't been spent yet. Pickled's trap declarations are designed for exactly this; the next dogfood pass should add them and re-measure.

### 3. The router (llms.txt) gets the path but misses the symbols

`[quick · superdoc_llms · *]` got `superdoc/ui/react` right (the router explicitly names the subpath) but missed both `SuperDocUIProvider` and `useSuperDocUI`. The router is concise enough to land the layer model but doesn't name the specific exports. The bundle (`llms-full.txt`) carries that detail.

Action: working as intended. The router is a navigation surface; the bundle is the implementation surface. Both files have a role; neither alone is sufficient. SuperDoc's existing two-file shape is right; no change recommended.

### 4. Pickled reporter gap (out of scope to fix here): grouped_check_pass ignores excludes

The reporter said "Full readiness signal on `[quick · superdoc_llms_full · web]`: symbols 2/2, paths 1/1" - but that cell PARTIAL'd because both excludes were hit. Calling it a "Full readiness signal" is misleading. The honest fix is one of:

- Require excludes-all-satisfied for `grouped_check_pass` to fire (strict reading of "full readiness").
- Rename to something like "grouped positive signal" and explicitly include the excludes status in the message.

File as a small follow-up issue against #22. Not blocking this dogfood; the receipt is more useful with the bug as-is because it surfaces the gap.

### 5. Two cells errored on transient infrastructure

`[quick · none · web]` got `ConnectionRefused` from the Claude Code SDK; `[quick · superdoc_context7 · web]` hit `maxTurns=15`. Neither is a SuperDoc finding. Worth noting for v2: bumping `maxTurns` and adding a single retry on transient SDK errors would prevent these from hiding real signal in the overall score (16/100 is dragged down hard by the two zeros).

## What v2 should be

Driven by the receipt above, not pre-built:

1. **Add traps for the legacy surface.** `createHeadlessToolbar`, `superdoc.activeEditor.commands.*`, `addCommentsList()`, `python-docx`. The dogfood's current `excludes` catches presence; a trap declares them as known-stale (per pickled #20). The trap-firing diagnostic will be more honest than a partial-from-excludes.
2. **Add a trap for the 180+ vs 12 MCP-tools drift.** A scenario that asks "how many MCP tools does SuperDoc expose?" - assert `12`, trap `180+`. SuperDoc should know about its own source drift before users report it.
3. **Expand to `anthropic_api` and `openai_api` interfaces.** Once the assertions are calibrated (this run confirms they are), the matrix can fan out per the cli-v0.25.0 cross-provider story.
4. **Add 2-3 more readiness scenarios** the receipt suggests would surface different signal: custom comments sidebar (`useSuperDocComments`, `modules.comments=false`), comment composer with selection capture (`ui.selection.capture`, `createFromCapture`), Document API mutation (`editor.doc.comments.create`, trap on direct ProseMirror access). Author each only after the previous one's assertions hold.
5. **Open the small reporter fix** for `grouped_check_pass` + excludes (finding 4 above).

## Anti-recommendation

Do **not** ship more scenarios upfront before running this row across more interfaces. The current single-scenario receipt already produced 5 actionable findings; widening the matrix before stabilizing the assertions risks 25+ PARTIAL cells that obscure rather than illuminate. Cost-control flags (`--sample`, `--max-cells`) from #17 are the safety net; use them on every v2 expansion.

## Snapshot artifacts

- Scenario YAML: snapshot in the file itself above.
- JSON receipt: not committed (lives at `/tmp/superdoc-dogfood/receipt.json`). 22.3KB; mostly per-cell allResponses. If wanted in this repo, copy to a `proposals/superdoc-readiness-dogfood.receipt.json` sibling.

---

# v2.1: reframed around "what context path does the agent get?" (2026-05-25)

## Why v2.1 exists

v1 asked the right question (does the agent get the right answer when given the right source?) but the framing was source-quality-comparison-shaped. The Discord report was actually about **context delivery** - the user gave their agent a docs link / web tools / an MCP server, and asked it to build with SuperDoc. The honest test is "for each context-delivery mode, does the agent produce the right implementation guidance?"

The wide intermediate v2 (72 cells, 4 scenarios) was killed mid-run because it mixed too many axes at once. v2.1 reframes around the simple product question.

## Scenario shape

One scenario (custom React toolbar) × 2 interfaces (Claude Code, OpenAI Responses) × 8 source/toolset combinations = 16 cells. The 5 setups the user actually wanted are the "diagonal" cells (no source × tool, or source × no tool); the other 6 are hinted-discovery extras (source + tool) that pickled's Cartesian matrix produces.

Sources: `none`, `superdoc_llms_full` (the official curated bundle).
Toolsets: `none`, `web`, `superdoc_mintlify_mcp` (official Mintlify docs MCP, public HTTP, verified live), `context7_mcp` (third-party docs MCP, requires `CONTEXT7_API_KEY`).

Assertions unchanged from v1: same `expected.symbols / paths / excludes`.

## Receipts (live run, 2026-05-25)

Overall: 44/100. Below is the five-setup view across both interfaces (the user's mental model; ignores the 3 hinted-extra rows per interface):

| Setup | Claude Code (quick) | OpenAI API (gpt-5.2) |
|---|---|---|
| **A. none** (model prior) | PARTIAL 40 | PARTIAL 40 |
| **B. docs_link** (bundle injected) | PARTIAL 40 (**both excludes HIT**) | PARTIAL 40 (**both excludes HIT**) |
| **C. web** (default web tools) | ERROR (maxTurns=15 loop) | PARTIAL 40 |
| **D. mintlify_mcp** (official) | **YES 100** | PARTIAL 80 (missed SuperDocUIProvider) |
| **E. context7_mcp** (third-party) | PARTIAL 80 (missed SuperDocUIProvider) | **YES 100** |

The 3 hinted-extra rows per interface (source + tool) mirrored their tool-only counterparts: the docs-link-plus-tool variants tracked the tool-only verdict, not the docs-link-only verdict, suggesting the agent used the tool (web/MCP) rather than the injected source when both were available.

## Findings (v2.1)

### 1. MCP beats docs injection on the custom React toolbar scenario. Counter-intuitive but earned.

The strongest finding, and not what we expected before running. **On this one scenario, both providers scored higher with an MCP server (no source injected) than with the official `llms-full.txt` bundle injected.** One scenario does not generalize to all SuperDoc topics; it is, however, a clear signal worth re-testing on a second scenario before drawing a category-wide conclusion.

- Mintlify MCP on Claude Code: **YES 100** (clean across symbols + paths + excludes)
- Context7 MCP on OpenAI: **YES 100** (clean across all)
- Docs-link injection on either provider: PARTIAL 40 (anti-patterns leak; both excludes HIT)

Why: MCP returns *focused snippets* via search + filesystem-read, so the agent's context window contains only the relevant React-UI surface. Injecting the full bundle gives the agent ambient knowledge of the legacy surface (`createHeadlessToolbar` is somewhere in the bundle, in a migration or comparison section), and the agent's answer mentions both the right and the legacy names.

**Action for SuperDoc:** promote the Mintlify MCP server as the recommended agent-context path, ahead of "here's our docs URL." Both `docs.superdoc.dev/.well-known/mcp` and the canonical endpoint are public and need no auth.

### 2. The Discord report on Context7 needs nuance.

v1 found that Context7's *flat llms.txt URL* (the contributor-setup-heavy one Context7 serves at `https://context7.com/superdoc-dev/superdoc/llms.txt`) was bad. v2.1 finds that Context7 *as an MCP server* (with its search + retrieval tools) is competitive - YES 100 on OpenAI, PARTIAL 80 on Claude Code.

The Discord complaint was likely about whichever surface the agent's Context7 integration consumed. If it consumed the flat llms.txt, the complaint matches v1. If it consumed the MCP retrieval, the complaint may have been about something else (search relevance, specific query) - Context7's MCP did fine here.

**Action for SuperDoc:** if users are reporting Context7 quality issues, ask which Context7 surface their agent uses. The flat index ≠ the MCP retrieval.

### 3. Docs injection has an anti-pattern-leak problem the MCP path avoids.

v1's finding 2 reproduced on BOTH providers in v2.1: with `superdoc_llms_full` injected, BOTH `createHeadlessToolbar` and `activeEditor.commands` showed up in the agent's answer, despite the bundle saying not to use them.

The MCP path avoided this consistently. The injected-bundle path failed consistently. Strong signal for SuperDoc: the bundle's "DO NOT USE" salience is not high enough to override agent prior knowledge of the legacy names when those names appear anywhere in the surrounding context.

### 4. Default web tools cannot reliably reach SuperDoc docs.

- Claude Code's WebSearch+WebFetch loop on the toolbar question hit maxTurns=15 (errored). The agent thrashed trying to find the right SuperDoc page.
- OpenAI's hosted `web_search` returned a useful tool call but the answer was still PARTIAL 40 (missed all symbols + path).

Neither provider's default web stack reached the actionable SuperDoc surface in this scenario. The web cell is the worst-performing context mode in v2.1, worse than even no-context model prior in the "symbols hit" axis.

**Action for SuperDoc:** SEO / discoverability matters. If most users reach for docs via "search Google for superdoc react toolbar," the web tools have to land on the official docs reliably. Right now they don't.

### 5. Reporter signals worked

Four `grouped_check_pass`, four `interface_comparison`, and one `source_comparison` diagnostics fired correctly (9 total). The post-#24 reporter no longer mislabels excludes-hit cells as "Full readiness signal" (the `docs_link` cells correctly stayed silent of that diagnostic; only the MCP and clean cells got it).

## What v2.1 changes about the v1 "What v2 should be" list

- `(1) Add traps for the legacy surface` - partially carried out via `excludes` in v2.1; the trap-vs-exclude question stays open (excludes are scenario-specific, which is right per critic guidance for `createHeadlessToolbar`).
- `(2) Add a trap for the 180+ vs 12 MCP-tools drift` - not run in v2.1 (scope tightened to one scenario). Worth a future small pass.
- `(3) Expand to anthropic_api and openai_api interfaces` - done (OpenAI added; Anthropic skipped because MCP toolsets on Anthropic aren't shipped per #13).
- `(4) Add 2-3 more readiness scenarios` - explicitly NOT done (anti-recommendation respected).
- `(5) Open small reporter fix` - done (#24 -> cli-v0.28.1, behavior visible in v2.1's diagnostic output).

## Next concrete actions for SuperDoc product

1. **Promote the Mintlify MCP server in `llms.txt` and `README` as the recommended agent context path.** It's public, no auth, and the receipt shows it produces better implementation guidance than handing the bundle to the agent.
2. **Audit `llms-full.txt` for anti-pattern salience.** The deprecated names leak into agent answers even when the bundle warns against them. Possible fixes: move warnings to the top, fence deprecated sections, remove migration-history names from the bundle entirely (keep them in docs but not in the AI context).
3. **SEO/discoverability check on `docs.superdoc.dev`.** Web cells couldn't reliably reach the right docs in either provider's default tooling. The Discord report is partially about this.
4. **Codex coverage is worth opening as a focused pickled feature issue** if SuperDoc users heavily use Codex; v2.1's two-provider receipt confirms the assertions calibrated cleanly, so Codex would slot in as a third cell row.

## Anti-recommendation (still applies)

Do not add more SuperDoc scenarios upfront before the next iteration. v2.1's 16-cell receipt produced 4 strong findings (MCP-beats-injection, Context7-nuance, anti-pattern-leak-reproduced, web-discovery-fails). Wider scope dilutes the signal.

## Snapshot artifacts (v2.1)

- v2.1 scenario YAML: `/tmp/superdoc-dogfood/pickled.yml` (live during run; ephemeral)
- v2.1 JSON receipt: `/tmp/superdoc-dogfood/v2_1-receipt.json` (55 KB; not committed - mostly per-cell allResponses)
- v2-wide killed config: `/tmp/superdoc-dogfood/pickled.yml.v2-wide` (snapshot of the 72-cell attempt that was killed before completion)
- v1 snapshot: `/tmp/superdoc-dogfood/pickled.yml.snapshot`

If receipts should live in the repo for reproducibility, copy to `proposals/superdoc-readiness-dogfood.v2_1-receipt.json` siblings.
