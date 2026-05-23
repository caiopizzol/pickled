# plan.md

Parking lot for valid-later, not-active-now ideas. Keep these out of the code and the active roadmap so they do not distract from the matrix evaluation product (`proposals/matrix-evaluation.md`).

Move an item from this file back into a tracked issue when it becomes the next critical-path step. Items below have been deliberately removed from active proposals, dogfood, schema, or roadmap to keep the working surface focused.

## Parked: source loader extensions

- **MCP-resource-as-source loader.** Vendor publishes their own MCP server's resources; pickled fetches ahead of time and injects as registered source text. Locked design in `proposals/mcp-resource-source-loader.md`. Valid for the `(Tools: none, Source: MCP resource)` cell. Deferred until matrix scoring primitives exist.
- **Skill-as-source loader.** Register SKILL.md + referenced scripts as one logical source. Design conversation never started; defer until vendors ask.

## Parked: internal-context evaluation

- **Internal comment / JSDoc drift.** Earlier session work explored detecting stale prose in code comments against the code's actual behavior. Useful product idea, distracts from the external-matrix story. Revisit only after external-matrix evaluation ships.
- **AIDEV-NOTE anchor verification.** Same category.
- **Comment-policy.md enforcement automation.** Same category. Today's audit catches structural issues only; semantic enforcement was a thought experiment.

## Parked: discovery / observation surfaces

- **Public web observation mode.** "What does StackOverflow / blog posts / GitHub issues say about your product?" Crawl-shaped, hard to interpret, leverage problem (vendors cannot fix other people's content). Revisit once the controllable matrix (vendor's own surfaces × interfaces × toolsets) produces real signal.
- **Native chat UI testing** (Claude Desktop, ChatGPT, Gemini). Browser/app surfaces are out of programmatic reach. API targets cover the underlying-model angle for those interfaces.

## Parked: audit extensions

- **Audit cross-reference for URL sources.** Today's audit skips URL sources to stay local and deterministic. Opt-in URL scanning with timeouts and cache is a real follow-up; defer until vendors report needing it.
- **Audit cross-reference for MCP sources.** Same shape as URL: skipped in audit; revisit if vendor pain shows up.
- **Reusable / global traps.** Schema change to let one trap definition be referenced from multiple scenarios. Touched by the trap-id uniqueness rule shipped in `cli-v0.14.0`. Real product idea, deferred.

## Parked: more agent targets

- **OpenAI API target with Responses API + web search.** Real and high-value once matrix scoring exists; needs OPENAI_API_KEY in CI, new adapter, citation-shape mapping.
- **Google API target.** Same shape as OpenAI, lower priority.
- **Gemini CLI target.** Declared in `CliProvider` type but unimplemented. Wait for matrix.
- **Amazon Q CLI target.** Same.
- **Cursor / Windsurf / IDE targets.** Each needs investigation of its automation surface; most do not have a stable programmatic interface for "ask one question, get one answer."

## Parked: toolset adapters

The matrix evaluation proposal lists `none / web / mcp / firecrawl` as planned toolset profiles. The schema slot for `toolsets` shipped in `cli-v0.16.0`; the `none` baseline shipped then too; `web` on Claude Code shipped in `cli-v0.17.0`; the generic MCP live-toolset adapter shipped in `cli-v0.18.0`. The remaining adapter implementations are each their own work:

- ~~**WebSearch + WebFetch on Claude Code.**~~ Shipped in `cli-v0.17.0` (toolset profile `web` with `webSearch: true` / `webFetch: true` flags). Discovery-system prompt + per-cell `toolsUsed` capture + per-cell error containment hardened in `cli-v0.17.1`. Tool-use provenance + hard veto + non-none-contract validation hardened in `cli-v0.17.2`.
- ~~**MCP as live tool.**~~ Shipped in `cli-v0.18.0` as a generic adapter (`ToolsetConfig.mcpServers`). Any MCP server reachable via `stdio` / `http` / `sse` can be declared. Each MCP cell sets the SDK's `tools: []` (no built-ins) plus `allowedTools: [mcp__<server>__*, ...]` (auto-permission), so the agent is confined to the configured MCP path with no Read/Bash fallback; any invocation of `mcp__<server>__*` counts as provenance. Context7 ships as the dogfood example, not a special case. `pickled.yml` string values matching `${UPPER_SNAKE_CASE}` are expanded from `process.env` at load so auth headers stay out of the config. Design locked in `proposals/mcp-toolset.md`.
- **Firecrawl as toolset.** Web-crawl-as-tool. New mechanism.
- **Anthropic API native `web_search_20250305` tool.** Server-side search; distinct from Claude Code's client-side WebSearch. Different citation/provenance shape.
- **OpenAI Responses API web_search.** Same shape as Anthropic native; OpenAI-specific.

## Parked: cost / sampling for matrix expansion

- **Matrix sampling primitives.** Once interface × source × toolset × scenario expands, full-matrix runs cost a lot. Need cell-level sampling, cached cells, gated cells (only re-run when relevant inputs change). Real proposal needed before the matrix grows.

## Parked: brand / docs rewrites

- **brand.md two-mode language.** Earlier session work proposed splitting brand around controlled vs discovery modes. Matrix framing supersedes that; brand should crystallize the one-product story after schema + dogfood examples cohere. Don't write aspirational brand language before the contract exists.
- **README.md rewrite around matrix.** Same. Comes after matrix scoring lands.

## How to use this file

When picking up a parked item:
1. Open or reopen a GitHub issue for it.
2. Write or refresh the proposal in `proposals/`.
3. Delete the entry from this file.
4. Implementation follows the release-discipline pattern at AGENTS.md §Release discipline.

When parking a new item:
1. Add a one-paragraph entry under the right section.
2. Link any existing proposal or issue as the design record.
3. Close or relabel the corresponding GitHub issue if it implies active priority.
