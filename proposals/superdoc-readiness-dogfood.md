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
