---
name: "pickled"
tagline: "Test what agents actually understand."
version: 2
language: en
---

# pickled

## Strategy

### Overview

Pickled is an open-source CLI that tests whether real agents can answer and build with your product, across declared context paths, using deterministic evidence. The evidence is fact coverage and misstatement checks matched against the answer, tool-use provenance, and build verification. No LLM grades another LLM.

Pickled started as a freshness checker for developer tool docs. It got rewritten when the real problem became clear, and the real problem has three surfaces, not one.

- **Agent surface.** Where the interaction happens. Today: Claude Code and Codex CLI. Designed for future targets like Antigravity CLI, Amazon Q, Cursor, hosted API agents, and whatever else exposes your product to agents.
- **Context surface.** What agents can read about your product. README, llms.txt, API references, examples, hosted source bundles, public docs, private docs.
- **Prompt surface.** The subset of context that actively steers behavior. Inline comments, JSDoc, CLAUDE.md, AGENTS.md, runbooks, agent instructions.

The same product can be legible in one agent surface and illegible in another, because each one gets a different slice. Pickled measures that per surface.

**What it really does.** Pickled turns "does AI get my product right?" into a testable contract. You declare sources, agents, contexts, and tasks (questions and builds). The framework runs each task per `(agent x context)` cell: questions score fact coverage and misstatement rejection, builds score a pass rate across trials. Receipts per cell.

**The problem.** Every API-backed product now has multiple readers. Some are people. Some are agents. The agents get different context bundles depending on which surface they live in, and each one fails in characteristic ways:

- **Missing context.** The agent never saw the relevant source.
- **Stale context.** The agent saw an old version of the truth.
- **Contradictory context.** Two sources disagree, and the agent picks the wrong one.
- **Overbroad context.** A vague rule overrides a specific one.
- **Surface-specific drift.** The same question passes on one agent surface and fails on another because they received different context bundles.

Generic eval frameworks ask "did the model produce the expected output?" Documentation platforms ask "is the page published?" Pickled asks the specific question those tools usually don't: can this agent, on this surface, use this product's actually-declared context to answer or build correctly?

**Transformation.** Before: you hope AI gets your product right and find out from angry GitHub issues. After: you have a deterministic score, per surface, per task, that fails CI when it drops.

**Long-term ambition.** Become the standard CI check for agent legibility across API-backed products.

### Positioning

**Category.** Agent legibility evaluation for API-backed products.

**Where pickled sits in the stack.** Pickled sits after context and before trust. Context layers (llms.txt, Context7, Mintlify) make your product legible to agents in principle. Generic eval frameworks (Promptfoo, Inspect AI) test prompts and models in the abstract. Production observability (LangSmith, Helicone, Langfuse) watches what already happened. Pickled runs in between: after context has been laid down, before the user has to trust the answer.

**What pickled is NOT.**

- Not a generic prompt eval framework. Promptfoo and Inspect AI test prompts and model behavior; pickled tests how a specific product is understood through specific surfaces.
- Not a docs platform. Mintlify and Docusaurus ship pages; pickled checks whether the pages, plus everything else an agent reads, hold up under test.
- Not a context delivery layer. Context7 and llms.txt feed agents; pickled verifies what comes out the other side.
- Not LLM observability. LangSmith and Helicone watch production traffic; pickled runs pre-release checks against declared sources.
- Not GEO. Profound and Otterly count brand mentions; pickled scores answer-correctness against your own truth.
- Not dashboard-first. Pickled runs in your terminal and in your CI. A hosted reporting layer can come later without changing what's scored.

**Structural differentials.**

- **Deterministic by contract.** The core score is parsed, not judged. Facts and misstatements are matched against the answer by code. Build tasks pass or fail on commands. No LLM judges the result.
- **Registered source contract.** You declare what counts as the product's truth. Pickled does not magically introspect; it grades against the sources you registered. The contract is the strength.
- **Product-specific tasks.** The tasks are your product's tasks, not a generic benchmark.
- **Per-surface scoring.** The same task can pass on one surface and fail on another. Pickled reports per-surface results because legibility is per-surface, not global.
- **Facts, misstatements, and verifier commands you control.** A grounded answer can still be wrong. A build that does not pass your commands did not build. You declare the contract, and Pickled scores it deterministically.
- **Cross-surface by design.** Today's targets: Claude Code and Codex CLI. The same config is built to run unchanged as Antigravity CLI, Amazon Q, Cursor, hosted API targets, and other surfaces land.
- **Source-agnostic.** Registers anything an agent can read. Public docs, private docs, llms.txt, CLAUDE.md, AGENTS.md, JSDoc, inline comments, internal handbooks, hosted source bundles. URLs or local paths.
- **The report is the receipt.** Each run produces a structured artifact: task, agent, context, fact coverage, misstatement result, tool provenance, build attempts, commands run, threshold result. The run fails on the receipt, not on a vibe. Default receipts are CI-safe; forensic receipts are explicit.
- **CLI-first. CI-native. No dashboard required.**
- **Open source. MIT.**

**Territory owned.** Product brine. The preserved layer between what a product knows about itself and what agents believe about it.

### Personality

**Archetype.** The Inspector and the Pickler, layered. The Inspector is the voice: rigorous, distrustful of self-grading, demands receipts, calm and dry. The Pickler is the metaphor: pickles aren't fresh, pickles are *preserved*, which is what you want your product to be inside agent memory.

**Attributes.** Rigorous. Deterministic. Plain. Dev-first. Opinionated. Slightly wry.

**Pickled IS.**

- Receipts over prose.
- Deterministic over interpreted.
- CLI over dashboard.
- Plain English over enterprise-speak.
- Tool-specific over generic.
- Honest about being early.

**Pickled is NOT.**

- Not a vendor.
- Not a platform.
- Not hype copy.
- Not a freshness emoji parade.
- Not a Salesforce-shaped pitch.
- Not a generic evals library that happens to handle tools.

### Promise

**Core promise.**

- You will know how AI sees your product, per surface.
- Scoring will be deterministic by contract.
- The check will run in CI.
- The truth will be checked, not assumed.

**Two audiences.** Pickled is built for two use cases that share the same machinery.

- **External.** Vendors and product teams testing how outside-world agents understand their product, given the docs, READMEs, llms.txt, hosted source bundles, and API references they publish.
- **Internal.** Engineering teams testing whether their own context (CLAUDE.md, AGENTS.md, JSDoc, inline comments, runbooks, internal handbooks) steers their own agents correctly inside their own codebase.

The second case is not secondary. It is where prompt surface becomes product-critical, and it is the bridge between pickled and benchmarks like comment-bench and agents-md-bench.

**Base message.** Pickled tests whether real agents can answer and build with your product, across declared context paths, using deterministic evidence.

This is the one-sentence description used as the lead line in `README.md`, `apps/cli/README.md`, and the homepage hero subtitle. Keep it verbatim across surfaces so the npm page, the GitHub repo overview, and any external write-up all read the same. When the product story shifts (new axis, new signal, new scoring rule), update this line first and propagate; do not let READMEs drift from it.

**Synthesizing phrase.** Pickled exists to keep products legible after agents enter the room.

### Guardrails

**Tone summary.** Terse. Honest. Plain. Dry. Opinionated.

**Pickled cannot be.**

- A vendor pitch.
- An AI hype piece.
- Enterprise procurement copy.
- A self-graded eval.
- A consultancy with a CLI bolted on.
- A freshness percentage with no teeth.

**Litmus test.** If it sounds like a vendor, cut it.

## Voice

### Identity

We're an open-source CLI for testing what AI agents actually understand about your product.

We run on the agent surfaces your product actually reaches. Today, Claude Code and Codex CLI. Designed for future targets like Antigravity CLI, Amazon Q, Cursor, hosted API agents, and whatever else lands. We pull from every kind of context an agent could read on the way there. Your README. Your llms.txt. Your CLAUDE.md. Your AGENTS.md. Your JSDoc. Your inline comments. Your internal handbook. We run the same tasks across each agent surface and score the result against the contract you declared: answer checks or build verification.

Nothing here is graded by another model. Facts and misstatements are matched against the answer by code. Build tasks pass or fail on commands. The score is the score.

Agent legibility is not a checkbox. It is behavior under test.

We are not a prompt eval framework. We are not a docs platform. We are not LLM observability. We are not a brand-mention tracker. We are not a vendor.

We're the proof that your product stays legible as the agent surface shifts under it.

**Essence.** Agent legibility, measured.

### Tagline & Slogans

**Primary tagline (homepage hero).** Test what agents actually understand.

The clearest bridge between the playful brand and the serious category. Use on the homepage hero, launch posts, and product intros where a first-time reader needs to grasp the product before they grasp the term "agent legibility."

**Essence line (category, repo subtitle, GitHub description).** Agent legibility, measured.

This is the line that defines the category for people who already know what's at stake. Use it as the GitHub repo description, as a subtitle under the primary tagline, and as the line under the logo on a slide.

**Alternates.**

- Keep your product legible to agents.
- Evals for the surfaces agents actually use.
- If agents can touch it, test it.

**Slogans for different contexts.**

- "Evidence or it didn't happen." (Hero subhead, inspector mode)
- "One config. Many surfaces. One score per surface." (Cross-surface explainer)
- "If the cell can't prove it, it doesn't count." (Scoring explainer)
- "Run the check. Read the score." (How-it-works)
- "Anything an agent reads can be registered as a source." (Source coverage explainer)
- "Comments are prompt surface." (Internal-team-use callout)
- "Test the brine before you ship the jar." (Pickle-mode reminder)
- "Stay fresh." (Footer sign-off only, the pickle nod)

### Manifesto

Your product has more readers now.

Some are people. Some are agents. All of them act on what they understand.

Each agent lives on a different surface.
Claude Code. Codex CLI. Cursor next. Hosted API targets after that. Whatever ships next month.

Each surface gets a different slice.
Of your README. Your llms.txt. Your CLAUDE.md. Your AGENTS.md. Your JSDoc. The inline comment someone shipped at 2am.

Each one fails in characteristic ways.
Missing context. Stale context. Contradictory context. Overbroad context. Surface-specific drift.

The wrong answer rarely looks wrong at first.

It cites the old install command. It skips the auth step. It uses the deprecated method. It sounds confident enough to waste an afternoon.

That is the problem.

Not a content problem. Not a model problem. A legibility problem, across surfaces, against context you mostly already wrote.

So we test it.

We register the source. We run the task. We check the answer or verify the build. We hold it to the contract you declared.

Agent legibility is not a checkbox.
It is behavior under test.

A pickle isn't fresh.
A pickle is preserved.

That's the work.

pickled

### Message Pillars

**Scoring is deterministic by contract.** The score is parsed, not judged. Facts and misstatements are matched deterministically. Build verification runs commands. No LLM judges the result. The score is the score.

**Registered source contract.** Pickled does not magically introspect your product. You declare what counts as the truth: README, llms.txt, CLAUDE.md, AGENTS.md, JSDoc, inline comments, internal handbooks, hosted source bundles. Anything an agent reads can be registered as a source. Anything not registered does not count. The contract is the strength.

**Per-surface legibility.** The same task can pass on one agent surface and fail on another, because each surface gets a different context bundle. Pickled scores per surface. One config. Many surfaces. One result per surface.

**Three-surface taxonomy.** Agent surface (where the interaction happens). Context surface (what the agent can read). Prompt surface (the subset that actively steers behavior). Pickled treats them as distinct because they fail differently.

**Failure modes.** Stale answers come from real categories, and the brand names them.

- Missing context: the agent never saw the source.
- Stale context: the agent saw an old version.
- Contradictory context: two sources disagree and the agent picked the wrong one.
- Overbroad context: a vague rule overrode a specific one.
- Surface-specific drift: the same task passed elsewhere.

**Facts, misstatements, and verifier commands you control.** A grounded answer can still be wrong. A build that does not pass your commands did not build. You declare the facts an answer must cover, the misstatements it must not make, and the verifier commands a build must pass, and Pickled scores that contract deterministically.

**The report is the receipt.** Each run leaves an artifact: task, agent, context, fact coverage, misstatement result, tool provenance, build attempts, commands run, threshold result. The receipt is what fails CI. The receipt is what gets diffed against last week's. Inspectors carry receipts. Default receipts are safe for CI artifacts; `--verbose` is the forensic path.

**Internal-team use is first-class.** Pickled is for teams testing how the outside world's agents understand their product, and for teams testing whether their own context steers their own agents correctly inside their own codebase. Comments are prompt surface. Stale prompt surface is product debt, not harmless prose.

**CLI-first. CI-native. No dashboard required.** Runs locally. Runs in CI. Pipe it, diff it, threshold it.

**Open.** Free. MIT. No login.

**Preservation, not freshness.** Your product needs to survive in agent memory. Fresh fades. Preserved holds.

### Phrases

- Test what agents actually understand.
- Agent legibility, measured.
- Pickled sits after context and before trust.
- Agent legibility is not a checkbox. It is behavior under test.
- Evidence or it didn't happen.
- The score is the score.
- Comments are prompt surface.
- Stale prompt surface is product debt, not harmless prose.
- A grounded answer can still be wrong.
- Anything an agent reads can be registered as a source.
- Facts and misstatements are matched deterministically.
- The report is the receipt.
- One config. Many surfaces. One score per surface.
- Test the brine before you ship the jar.
- Product brine. The preserved layer between what a product knows about itself and what agents believe about it.
- A pickle isn't fresh. A pickle is preserved.

### Playfulness

Pickled should be dryly playful, not silly. The joke is preservation, proof, and the jar. The product must feel strict enough to trust, with just enough weirdness to remember.

Play is allowed in footer sign-offs, empty states, success states, small labels, CLI microcopy, and one or two campaign lines per page.

Play is not allowed in scoring semantics, check behavior, error states, competitive claims, setup instructions, or anything that explains whether a run passed or failed.

Use pickle language as punctuation:

- "A pickle isn't fresh. A pickle is preserved."
- "Test the brine before you ship the jar."
- "Product brine."
- "This jar has receipts."
- "Stay fresh."

Do not turn the product into a pickle joke. If the metaphor starts competing with the scoring contract, cut it.

### Interface Feedback

Every interface should use the same feedback grammar: CLI, CI logs, web demos, and the future app. The surface can change. The message should not.

**Default structure.**

1. Command or screen name.
2. Scope metadata: product, sources, tasks, agent, or context when relevant.
3. Task result (answer or build).
4. Evidence lines.
5. Overall score and threshold result.
6. One next-action sentence.

**Task result grammar.** One line per `(agent · context)` cell. Question cells
render the fully grounded result as `1/1` or `0/1` today; partial questions
append fact coverage. Build cells render the trial rate as `k/n`.

Question:

- `Task: How do I install?`
- `[quick · given_docs] ✓ Well grounded 1/1`
- `[quick · memory] ⚠ Partially grounded 0/1 (60% facts)`
- `[quick · web_open] ✗ Ungrounded 0/1`
- `[quick · docs_mcp] ✗ Error`

Build:

- `Task: Toolbar integration`
- `[builder · given_docs] ✓ Built 3/3`
- `[builder · given_docs] ⚠ Partially built 2/3`
- `[builder · given_docs] ✗ Did not build 0/3`
- `[builder · given_docs] ✗ Error`

**Evidence line grammar.**

- `reason: missing facts: install_command`
- `reason: misstatement: npm_install`
- `reason: tool path not used (provenance)`
- `tools: WebSearch`
- `failed: toolbar behavior (failToPass)`
- `verifier unproven` / `verifier broken (reference solution failed)`

**Overall grammar.**

- `Overall: 92 / 100 · threshold 80 · run passes`
- `Overall: 42 / 100 · threshold 80 · run fails`
- `Overall: 100 / 100 · threshold 80 · 1 errored · run fails`
- `Overall: 92 / 100` (no threshold configured)

Use `run passes` and `run fails` everywhere. Do not switch between `CI fails`, `build fails`, and `check failed` for the same state.

**Verdict layers.**

Pickled has two verdicts. They are orthogonal. Renderers must not conflate them.

- **Cell verdict** answers whether one `(agent × context)` cell satisfied its contract. Values: `YES`, `PARTIAL`, `NO`, `Error`. Question cells render as `Well grounded`, `Partially grounded`, `Ungrounded`, or `Error`. Build cells render as `Built`, `Partially built`, `Did not build`, or `Error`.
- **Run verdict** answers whether the run met the configured threshold. Values: `run passes`, `run fails`. Renders only when a threshold is configured. Without a threshold, show `Overall: X / 100` and stop. A thresholded run with any errored cell fails: the score excludes error cells, so an unmeasured cell must never pass CI.

The cell verdict determines the label family. A question cell is `YES` only when the scored response fully satisfied the contract (all expected facts covered, no rejected misstatement, the tool path used); the fully grounded result and fact coverage are rendered as detail (`1/1` or `0/1`, `% facts`) but never upgrade `PARTIAL`, `NO`, or `Error`. Build cells use the build label family and render the pass rate as `k/n`; they never use the grounded scale. The categorical signal wins.

Implementation rule: one shared helper (`report-status.ts`) returns the label, icon, tone, score, and run verdict. Every renderer (terminal, markdown, JSON, web) consumes it. None computes the label, the score, or the pass/fail itself.

**Feedback tone.**

- Be concise.
- Name the failed contract.
- Show the evidence.
- Give one next action.
- Do not explain the brand in the result.
- Do not use pickle language in pass/fail semantics.
- Do not use cute copy in error states.

**Good terminal copy.**

```text
pickled check
Product: zod
Sources: [readme], [llms]
Tasks: 1

Task: How do I parse safely?
  [quick · given_docs] ✓ Well grounded 1/1
  [quick · memory] ⚠ Partially grounded 0/1 (50% facts)
      reason: missing facts: safe_parse

Overall: 75 / 100 · threshold 80 · run fails
Review the answers that fell short of their checks.
```

```text
pickled build
Product: my-product
Sources: [docs]
Tasks: 1

Task: Toolbar integration
  [builder · given_docs] ⚠ Partially built 2/3
      reason: Built 2/3
      failed: toolbar behavior (failToPass)

Overall: 67 / 100 · threshold 80 · run fails
Review the build attempts that failed verification.
```

### Release Notes

Release notes are a public interface surface. They are subject to the same grammar as CLI output: short, specific, no marketing voice.

Release notes are currently generated deterministically by `@semantic-release/release-notes-generator` from conventional commit subjects (see `plan.md` → Parked: release-notes hardening for context on why the AI notes plugin was removed). The rules below still apply: they describe the target voice for the AI notes plugin we want to restore, and the shape every hand-edited release body should follow. While deterministic notes ship, the cleanest way to satisfy them is to write commit subjects that read like the bullet shape below.

A one-off hand-edit via `gh release edit` on a high-stakes release is fine; just don't let it substitute for fixing the generator path long-term.

**Section names.** Use only `What's New`, `Fixes`, `Improvements`, and `Breaking Changes`. Do not invent grouping headers like `Under the Hood`, `Other`, `Miscellaneous`, or `Behind the Scenes`. If a change does not fit one of the four, ask whether it belongs in the notes at all.

**Bullet shape.** One sentence per change. Lead with what changed for the user, not the implementation. Bold the feature name. Use a hyphen, never an em dash, to join the name and the description.

**Nouns.** Use the repo's actual terms: `JSON contract` (not `JSON schema`), `run passes` / `run fails` (not `build passes`), `cell verdict` and `run verdict` (not generic `pass rate`), `registered source` (not `source file`), `fact` and `misstatement` (the question contract: `expects` facts, `rejects` misstatements; not `assertion`, `check`, or `regression check`), `context` (a `(source, mode)` delivery path; not the old access wording). Question cells render `1/1` or `0/1` today; build attempts render `k/n`.

**Honesty constraints.** No absolutes. A smoke test `catches regressions in the example contract`; it does not `disprove any regression`. A guard `prevents drift between A and B`; it does not `guarantee parity`. If a change is doc-only, say so. If a dependency upgrade required no code changes, say so plainly without dressing it up.

**Skip.** Version bumps, CI tweaks that affect no user behavior, and code that exists only in proposals or drafts. The plugin's system prompt already says this; reinforce it here so the model has two signals pointing the same way.

**Good release-notes copy.**

```markdown
### What's New

- **llms.txt as public agent surface** - Agents can read pickled's contracts, targets, verdict layers, JSON contract, and source requirements at `/llms.txt`.
- **Brand and spec questions** - Five new dogfood questions covering verdict layers, JSON contract, target semantics, agent context contract, and comment policy.
- **Fact and misstatement contract** - A question scores on the facts its answer must cover and the misstatements it must not make, matched deterministically.

### Improvements

- **Dogfood stability** - Anchored JSON contract and Basic usage questions to their canonical sources to remove source-contract flake.
- **llms.txt drift guard** - CI verifies the public llms.txt stays in sync with the repo root.
- **Scoped API keys** - Split Anthropic key by workflow (release vs agent-dogfood) for cleaner rotation and audit.
- **Claude Agent SDK 0.3** - Upgraded from 0.2. No call-site changes.
```

### Social Bios

**LinkedIn.**

pickled is an open-source CLI that tests whether real agents can answer and build with your product, starting with Claude Code and Codex CLI, across the context paths your team controls: README, llms.txt, docs, MCP servers, hosted source bundles, internal handbooks. Evidence is matched deterministically. No LLM judges the result. MIT.

**Instagram.**

- 🥒 Open-source eval framework
- Agent legibility for API-backed products
- Across every source an agent reads
- Deterministic by contract
- CLI-first, CI-native, MIT

**X / Twitter.**

Open-source CLI. Tests what AI agents actually understand about your product. Deterministic by contract. No LLM grades the result. 🥒

**Website hero subhead.**

An open-source CLI that tests what AI agents understand about your product. Today, on Claude Code and Codex CLI. Designed for the surfaces and sources that will keep landing. Facts and misstatements are matched deterministically. The score is the score.

### Tonal Rules

1. Short sentences. Declarative. End on a verb or a noun, not an adjective.
2. Use words a developer would say out loud. No vendor-speak.
3. Show, don't sell. A code block beats a paragraph.
4. Second person when teaching. First person plural ("we") only when stating identity.
5. The pickle metaphor is a wink, not a theme. One mention per page in body copy, max. Global chrome is exempt: the logo (🥒 in nav and footer), the footer sign-off ("Stay fresh."), and file-title marks at the top of `README.md` and `pickled.yml` are quiet structural repeats and do not count against the body-copy limit. Saturation is the failure mode the rule prevents, not presence.
6. "AI" is fine. Hype phrasing is not.
7. Numbers are concrete. Never "up to X%" or "as much as X".
8. If a sentence could appear on a Salesforce page, rewrite it.
9. Cite when you make a claim. We're an eval framework. Practice it.
10. Don't apologize for being a CLI.
11. Be honest about being early. "Early" is more credible than "trusted by leading teams".
12. No em dashes. Periods, commas, parentheses, or hyphens only.

**Identity boundaries (what we are not).**

- We are not a consultancy that left a CLI behind.
- We are not a SaaS platform.
- We are not an LLM observability product.
- We are not a docs vendor.
- We are not a generic evals library.
- We are not graded by another model.

**We Say / We Never Say.**

| We Say | We Never Say |
|---|---|
| "Test what agents actually understand." | "Transform your product with agent magic." |
| "Agent legibility, measured." | "Become AI-ready in minutes." |
| "Evidence or it didn't happen." | "Built on a proprietary AI scoring engine." |
| "The score is the score." | "See everything with one magic dashboard." |
| "Deterministic by contract." | "Trust our intelligence layer." |
| "Comments are prompt surface." | "Documentation lives outside the product." |
| "One config. Many surfaces. One score per surface." | "Unified omnichannel evaluation suite." |
| "Stale prompt surface is product debt." | "Optimize your content for AI ingestion." |
| "Facts and misstatements are matched deterministically." | "Anomaly detected in your AI signal." |
| "A pickle isn't fresh. A pickle is preserved." | "Stay fresh with cutting-edge AI insights." |

## Visual

Authoritative palette and type lives in `apps/web/src/styles/tokens.css`. This section names what's there and explains how to use it. If the two diverge, tokens.css wins until a brand decision changes both.

### Colors

The palette is electric, not earthy. The pickle here is preserved in glass under a single bright light, not jarred on a farmhouse shelf.

**Primary - Neon Pickle.**

- Pickle Green `#00E676`. Primary actions, success states, score highlights, links, the most memorable brand accents. Should feel alive, not natural.
- Brine Green `#00C853`. Hover states, focused borders, compact UI accents.
- Fresh Cut `#69F0AE`. Sparingly, for glow, charts, and positive status details.

**Accent.**

- Jar Label Yellow `#FFD740`. Warnings, at-risk callouts, small editorial highlights. Pairs with electric green without competing.
- Jar Label Dark `#FFC400`. Hover and pressed states for accent surfaces.

**Semantic.**

- Success `#00E676` (same as primary).
- Warning `#FFD740` (same as accent).
- Spoil Pink `#FF4081`. Failed facts, rejected misstatements, destructive states.
- Interface Blue `#64B5F6`. Target/interface metadata and neutral system information.

**Backgrounds (dark by default).**

- Night Jar `#0A0A0F`. Primary background.
- Subtle `#0F0F16`. Lifted sections inside the primary background.
- Lid Black `#141420`. Terminals, cards, panels, and code-like blocks.
- Glass Edge `#1A1A28`. Raised controls and selected states.

**Text.**

- Salt White `#FFFFFF`. Primary text.
- Brine Gray `#8888A0`. Supporting copy, metadata.
- Shelf Gray `#50506A`. Disabled states, low-priority labels.

**Borders.**

- Border `#1F1F30`. Default panel and card edges.
- Border Hover `#2A2A40`. Interactive edges.

**Avoid.**

- Beige, rustic green, farmhouse-pickle palettes.
- Corporate blue dominance.
- Purple "AI" gradients.
- Pastel SaaS palettes.
- Natural food-brand greens.

### Typography

- **Display.** Space Grotesk, 600–700. Headlines, section titles, strong product statements, campaign copy. The feel should be technical, compact, and slightly odd.
- **Body.** DM Sans, 400–500. Paragraphs, UI copy, docs, cards, navigation. Keep line lengths moderate.
- **Mono.** JetBrains Mono, 400–600 (Fira Code as fallback). CLI commands, source IDs, task ids, agent names, fact ids, config snippets, score numbers, report output. Mono text should feel like product evidence, not decoration.

The score number is always mono. Always. It is the receipt.

### Photography

Skip photography. Use:

- Real CLI output. The actual terminal, the actual score, the actual evidence block.
- Code blocks with real YAML configs from `pickled.yml`.
- Abstract close-ups of jars, labels, brine, glass, and preservation only as texture, never as the main subject.

**Avoid.**

- Stock photos of "AI" or robots.
- Smiling enterprise team shots.
- People at laptops, hands on keyboards.
- Glowing brain graphics, particle-mesh "neural network" art.
- Literal pickles as the main subject in serious product contexts.

### Style

**Design keywords.** CLI-native. Preserved. Sharp. Compact. Electric. Inspectable. Open source. Dryly playful.

**Reference brands.** PostHog (handbook plus repo plus irreverence). Vercel (developer-native presentation and command-line clarity). Linear (precision without theatrics). Sentry (dev-tool gravitas). Cloudflare Workers docs (dense and clean).

**Anti-references.** Salesforce (bloated enterprise abstraction, inflated promise language, generic transformation messaging). Anything with "Trailblazer" energy. Anything that calls a customer a "partner." Anything that uses "synergy" unironically.

**Direction.** The identity should feel like a test report in a pickle jar: weird enough to remember, strict enough to trust. Visuals should make the product feel inspectable, runnable, and source-grounded, not magical. **The terminal is the hero. The pickle is punctuation.**
