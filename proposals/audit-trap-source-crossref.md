# Proposal: audit trap-source cross-reference

**Status:** decided and implemented. Schema + audit rule shipped across commits `ada9444` (schema migration), `917fa13` (audit cross-reference + tests), and `d925560` (pickled's own opt-out config + llms.txt rephrase). This file now reads as a design record. The dogfood prediction table below reflects the final HEAD state, not the pre-implementation state.
**Motivated by:** verified dogfood findings. Pickled's own `AGENTS.md`, `brand.md`, and `llms.txt` contain declared trap phrases (`freshness score`, `AI-powered`) as intentional ban declarations. Today nothing catches the inverse case: a registered public surface (README, CLI README, llms.txt body) carrying the same phrases as actual drift. The check-time trap engine only sees agent responses, not source text.

## Problem

`pickled.yml` traps are already a deprecation registry: they encode claims that should not survive in product surfaces (removed schema keys, banned phrases, deprecated CLI flags). The check pipeline matches them against agent responses. The audit pipeline does not match them against registered sources. So a stale claim can sit in `README.md` for months, never tested, until an agent reads it and parrots it. The trap then fires in `check` after the damage is already in production.

The matcher (`scoreTraps` in `packages/core/src/scorers/traps.ts`) is already a pure function over `(response, traps)`, so a new audit rule can call it with `response = sourceContents`. The audit pipeline does not currently load `docs.sources` (it scans `DOC_PATTERNS` agent docs only, `scan.ts:19-34`); this rule would extend it to load registered sources from `pickled.yml` for the cross-reference check.

## Proposal

Extend `pickled audit` with a new scan rule that:

1. Loads `pickled.yml`, reads `docs.sources` and the union of `scenarios[].traps`.
2. For every registered source not opted out, reads its contents and calls `scoreTraps({response: contents, traps: allDeclaredTraps})`.
3. Emits a finding per fired trap, including snippet, trap id, reason, and remediation text.
4. Respects per-source opt-out (Decision 1) and per-trap severity (Decision 2).

No new commands. No new mechanics. The audit just gains one rule, and the loader learns one new optional source-entry shape.

## Decision 1: scoped source opt-out

Per-source `audit.traps: false` field. Requires migrating `docs.sources` from `Record<string, string>` to `Record<string, string | DocSourceEntry>`. String form keeps working for backward compatibility.

```yaml
docs:
  sources:
    readme: ./README.md                  # string form, backward compatible
    stale:
      path: ./dogfood/stale-source.md
      audit:
        traps: false                     # skip trap cross-reference only
```

The opt-out is scoped to traps. Broken-link and path-ref checks still run on opted-out sources. A stale fixture deserves structural checks; it just should not be cross-referenced against the trap registry.

Default is opt-in (scan by default). Public surfaces dominate the use case; policy docs and fixtures are the minority that need marking. Opt-out has lower configuration cost than opt-in.

## Decision 2: `auditSeverity` per trap

Distinct from check-time semantics. In `check`, trap firing forces `answerable = NO`, `confidence = 0`: non-negotiable, codified in `brand.md` §Verdict layers. In `audit`, the same trap defaults to `warning`; vendors can upgrade to `error` per trap.

```yaml
traps:
  - id: old_schema
    match: "docs.source:"
    reason: "Recommends removed singular docs.source schema"
    auditSeverity: error
```

Default: `warning`. The audit's existing severity model accepts `"error" | "warning"` already (`schema.ts:96`). A plain `severity` field was considered and rejected: it would muddy the check-vs-audit boundary and make it ambiguous whether the field gates check behavior, audit behavior, or both.

## Decision 3: remediation message template

Findings must be actionable, not just descriptive. Template:

```
warning: source [readme] (./README.md:L42) matches trap `old_schema` ("docs.source:")
  reason: Recommends removed singular docs.source schema
  fix: Remove `docs.source:` from the README, retire the trap if no longer relevant,
       or set `audit.traps: false` on the source if it is deliberately stale or test-only.
```

Three remediation paths surfaced, in order of likelihood: fix the doc, retire the trap, opt out. Authoring an audit finding without a remediation menu is the failure mode this avoids: every finding answers "what do I do about this."

## Decision 4: first-run dogfood expectation

The proposal ships with an audit run against pickled itself, results posted in the implementation PR description. Verified prediction at proposal time (2026-05-22, pickled.yml has 6 declared traps: `old_schema`, `old_freshness_brand`, `ai_powered`, `freshness_score`, `provider_as_target`, `json_human_label`). Note: `old_freshness_brand` and `freshness_score` carry identical regex patterns, so one occurrence of "freshness score" in a source fires both traps. That is a config redundancy worth a follow-up (see Open Questions) but not a blocker.

Only entries in `docs.sources` are scanned. `apps/web/public/llms.txt` is the synced public copy, not a registered source; the existing CI sync guard (`ci.yml:42-43`) keeps it consistent.

| Registered source | Predicted fires | Detail | Disposition |
|---|---|---|---|
| `readme` (`./README.md`) | 0 | clean | scan, no action |
| `cli_readme` (`./apps/cli/README.md`) | 0 | clean | scan, no action |
| `comment_policy` (`./comment-policy.md`) | 0 | clean | scan, no action |
| `brand` (`./brand.md`) | 1 | `ai_powered` (lines 89, 418, 439 - "We Never Say" examples) | mark `audit.traps: false` |
| `agents` (`./AGENTS.md`) | 3 | `ai_powered` (line 61) + both freshness traps fire on line 58 | mark `audit.traps: false` |
| `llms` (`./llms.txt`) | 2 | both freshness traps fire on line 66 | see Open Question 1 |
| `stale` (`./dogfood/stale-source.md`) | 5 | all five non-`old_schema` traps fire after the `json_human_label` regex fix landed in `f9f20c5` | mark `audit.traps: false` |

Total: 11 findings across 7 registered sources before opt-outs. Real drift: zero. After opt-outs land in `d925560` (brand, agents, stale) and the rephrase of `llms.txt:66`, the audit reports zero findings. The release note leads with this: *"The new audit found zero stale claims in pickled's public docs."*

## Schema migration (the real engineering cost)

Most of the implementation is loader work, not audit work.

1. Introduce `DocSourceEntry { path: string; audit?: { traps?: boolean } }` in `packages/config/src/types.ts`.
2. Update `DocsConfig.sources` to `Record<string, string | DocSourceEntry>`.
3. Update `packages/config/src/loader.ts:36` to accept both forms, normalize to a canonical internal shape (`ResolvedDocSource & { auditTraps: boolean }`), and continue rejecting malformed objects.
4. Extend `Trap` in `types.ts:116` with optional `auditSeverity: "error" | "warning"` (default `"warning"`).
5. Add the audit scan rule (small: ~30 lines).
6. Tests: opt-out respected, severity default and override, dogfood prediction matches.

The matcher reuse is the cheap part. The schema migration is what makes "half a day" optimistic.

## What does NOT change

- Trap behavior in `check`. Firing still forces NO + confidence 0. Audit semantics are orthogonal.
- Existing string-form `docs.sources` configs. Backward compatible.
- Audit report shape. New findings slot into the existing `error | warning` model.
- Trap pipeline smoke scenario. The deliberately stale fixture stays in place; it now also carries `audit.traps: false`.

## Explicitly out of scope

- **URL source scanning.** `scanSourceTraps` skips sources whose path starts with `http://` or `https://` in v1. Audit is expected to be local and deterministic; including URLs would make every run network-dependent (latency, flake, rate limits). Vendors who want URL coverage still get it via `pickled check`. A follow-up may add opt-in URL scanning with timeouts and caching once the local rule has shipped.
- **Auto-suggested traps from git diff.** Different mechanism (rename detection on code changes feeding suggested trap entries). Revisit after this lands and produces data on how often manual trap maintenance is the bottleneck.
- **Compare-surfaces audit** (e.g., does README and llms.txt agree on the same fact). Needs a per-source `covers:` schema decision first. Sketched but deferred.
- **Remote link verification.** Network calls, rate limits, CI flake.
- **Comment/JSDoc drift.** Internal-surface scope; deprioritized per the broader product redirect to public-doc drift.

## Implementation order (when work begins)

1. Schema: extend `DocsConfig.sources` and `Trap` per §Schema migration.
2. Loader: normalize both source forms; reject malformed objects.
3. Audit: new scan rule iterating registered sources, calling `scoreTraps`, emitting findings with remediation text.
4. Tests: cover opt-out, severity default, severity override, remediation message rendering, mixed string + object source declarations.
5. Dogfood: mark expected policy docs and the stale fixture; verify the run produces zero unexpected findings.
6. Release: lead the notes with the dogfood result.

## Open questions

1. **Do not casually opt out `llms.txt`.** It is one of pickled's main public agent surfaces; full opt-out weakens the dogfood story (the public file pickled most wants agents to read becomes the file pickled does not check). Recommended path: rephrase the ban prose at `llms.txt:66` so it cites the rule without quoting the phrase verbatim (e.g., "do not reintroduce the legacy scoring branding"). If that prose contortion is unacceptable, defer to trap-id-level suppression (Open Question 2) rather than full opt-out.
2. **Should `audit.traps` accept a trap-id list instead of a boolean** (e.g., `audit.traps: [old_freshness_brand, freshness_score]` to skip these but scan the rest)? Probably yes eventually. Ship the boolean shape first; adding granularity later is non-breaking and lets Open Question 1 be resolved without prose contortion.
3. **Trap config redundancy.** `old_freshness_brand` and `freshness_score` declare identical regex patterns. They live in different scenarios (Config format vs Trap pipeline smoke) but the audit cross-reference treats them as two findings. Consolidate into one trap and reference it from both scenarios? Cleaner config; minor follow-up.
4. **`json_human_label` trap missed the stale fixture** (resolved in `f9f20c5`). Original pattern required "includes" to be immediately followed by optional quote then "Well grounded". Fixture had "includes human-friendly labels like 'Well grounded'", with intervening prose. Loosened the regex to allow up to 80 non-period chars between "includes" and "Well grounded", and dropped the `\b`-inside-char-class footgun (it was the backspace character, not a word boundary). Verified: matches the fixture, zero false positives across the seven registered sources.
5. **Line numbers in findings** (resolved in `917fa13`). Took path (a): extended `TrapHit` with `index: number` (byte offset of the match start). Audit computes 1-indexed line numbers from offset.
6. **Trap-ID severity collision** (resolved in pre-push cleanup). Two scenarios could declare different traps with the same `id` but different `auditSeverity`; an id-keyed severity map would let the second silently overwrite the first. The scanner now tracks severity per `Trap` object identity, not per id. Same-id traps are matched and reported independently.
