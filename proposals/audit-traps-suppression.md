# Proposal: fine-grained `audit.traps` source suppression

**Status:** draft, no implementation
**Motivated by:** the audit cross-reference rule shipped in `cli-v0.10.0` lets a source opt out entirely with `audit.traps: false`. The dogfood configuration of pickled itself had to opt out three sources (`brand`, `agents`, `stale`) because each contains a banned phrase as a declared example. That works, but it overshoots: those sources also escape future traps even when the future trap has nothing to do with their intentional examples. Vendors will eventually want "skip these specific traps but scan the rest." See issue #4 and `proposals/audit-trap-source-crossref.md` Open Question 2.
**Decision needed:** trap-id uniqueness rule for list-form suppression, schema migration shape, loader validation, audit-time filtering, dogfood follow-up on pickled itself.

## Problem

`audit.traps: false` is a blunt instrument. Today on pickled's own `pickled.yml`:

- `brand.md` opts out because it cites `AI-powered` as a banned-phrase example.
- `AGENTS.md` opts out because it cites both `freshness score` and `AI-powered`.
- `dogfood/stale-source.md` opts out because it deliberately fires every trap.

If a new trap is added later (say, for a new banned phrase, or for a deprecated CLI flag rename), those three sources continue to be skipped even when the new trap has nothing to do with their existing examples. The audit's signal weakens silently as the trap registry grows.

The fix is fine-grained: let a source declare *which* traps to skip while staying scannable for everything else.

## Proposal

Extend `audit.traps` from `boolean` to `boolean | string[]`. The string-array form lists trap ids to suppress for that source; all other traps still apply.

```yaml
docs:
  sources:
    plain: ./README.md                      # default: scan all traps
    agents:
      path: ./AGENTS.md
      audit:
        traps: [old_freshness_brand, freshness_score, ai_powered]
    stale:
      path: ./dogfood/stale-source.md
      audit:
        traps: false                        # still valid: skip every trap
```

Semantics:

- `audit.traps: true` (the default when omitted): scan with every declared trap.
- `audit.traps: false`: scan with no traps (existing v0.10.0 behavior, unchanged).
- `audit.traps: [<id>, ...]`: scan with every declared trap **except** those listed by id.
- Empty array (`audit.traps: []`) is rejected by the loader: ambiguous (did the author mean "skip none" or "skip all"?). Force them to write `true` or `false`.

The audit runtime in `scanSourceTraps` already iterates traps per source (commit `cf7bff5` made severity tracking per Trap object identity). Adding a per-source skip-set filter is a small change in the existing loop.

## Decision 1: trap-id uniqueness rule

The list form names traps by id. But pickled today only enforces id uniqueness *within* a scenario (`loader.ts:140` creates `seenIds` fresh per scenario). Cross-scenario duplicate ids are legal and exist in pickled's own config (`old_freshness_brand` and `freshness_score` carry identical regex patterns, currently as a redundancy noted in the previous proposal's Open Question 3). List-form suppression has to resolve this.

Three options were named in issue #4:

**Option A: Global trap-id uniqueness.** Loader rejects duplicate ids across all scenarios as soon as any source uses the list form. The trap registry is small (six entries in pickled today, likely tens for larger vendors) and the cost is one extra loader pass.

**Option B: Qualified ids.** Vendors write `"Config format.old_freshness_brand"` to disambiguate. Precise but verbose. The dot-as-separator collides with idiomatic id naming.

**Option C: Cross-scenario suppression.** A listed id suppresses every trap with that id across all scenarios. Loose semantics: same-id traps are treated as one logical trap for suppression purposes even if their regex or reason differs.

**Recommendation: Option A.** It is the strictest and the simplest. Forcing global trap-id uniqueness aligns with how pickled's product story treats traps - as a named deprecation registry. Same-id traps in different scenarios with different reasons are already a configuration smell (the proposal for the cross-reference rule flagged it as Open Question 3); requiring uniqueness encourages the right cleanup. The migration cost on pickled's own config is one rename: `old_freshness_brand` → reuse `freshness_score`, or vice versa, with the two scenarios sharing the trap.

Option B is rejected because qualified ids are verbose and the dot separator is ambiguous with id-naming conventions. Option C is rejected because it makes "what does this id mean" ambiguous and pickled's product depends on traps being precise.

The uniqueness rule applies **globally as soon as any list form is declared**. Configs that never use list-form suppression keep the existing per-scenario uniqueness behavior, so this is backward-compatible for vendors who only ever use `audit.traps: true` or `audit.traps: false`.

## Decision 2: schema migration

Update `DocSourceEntry.audit.traps` from `boolean | undefined` to `boolean | string[] | undefined` in `packages/config/src/types.ts`. The existing `false` and `true` paths keep working. The loader is extended in `validateDocSourceEntry` (currently in `loader.ts`) to accept arrays, validate that listed ids reference declared traps, reject empty arrays, and reject arrays containing non-string entries.

The `normalizeDocSource` helper currently returns `{ path, auditTraps: boolean }`. It becomes `{ path, auditTraps: boolean | string[] }`. Consumers that read `auditTraps` (today only `scanSourceTraps`) must handle the union; the change is a one-spot fix.

`ResolvedDocSource.auditTraps` follows the same migration.

## Decision 3: audit-time filtering

In `scanSourceTraps`, the current logic is:

```ts
if (source.auditTraps === false) continue;
for (const trap of trapsList) {
  // ... call scoreTraps, emit findings
}
```

New logic:

```ts
const skip = source.auditTraps;
if (skip === false) continue;
const skipSet =
  Array.isArray(skip) ? new Set(skip) : null;
for (const trap of trapsList) {
  if (skipSet?.has(trap.id)) continue;
  // ... call scoreTraps, emit findings
}
```

That is the only audit-side code change. The matcher, severity tracking, line-number computation, and finding-rendering all stay identical.

## Decision 4: loader validation

The loader gains three new checks:

1. If `audit.traps` is an array, every entry must be a string. Reject mixed types with a message naming the source id.
2. Every listed id must correspond to a declared trap somewhere in `scenarios[].traps`. Reject unknown ids with the list of declared ids so authors see the typo.
3. If any source uses the array form anywhere in the config, every trap id across all scenarios must be globally unique. Reject duplicates with a message naming both occurrences.
4. Empty arrays are rejected (`audit.traps: []` is ambiguous; the author should write `true` or `false`).

## What does NOT change

- Check-time semantics. Trap firing in agent responses still forces `answerable = NO`, `confidence = 0`, regardless of any audit suppression. `audit.traps` is audit-only.
- The structural audit rules (broken refs, line budgets, pair classification). They never consulted `audit.traps`.
- `auditSeverity` per trap. Unrelated; still applies to whichever traps actually run on a source.
- Boolean forms. `audit.traps: true` and `audit.traps: false` keep working exactly as today.

## Examples

**Source with one specific banned-phrase example, scanned otherwise:**

```yaml
brand:
  path: ./brand.md
  audit:
    traps: [ai_powered]      # skip just this trap; future banned phrases still scanned
```

**Source citing multiple banned phrases:**

```yaml
agents:
  path: ./AGENTS.md
  audit:
    traps: [ai_powered, freshness_score]
```

**Deliberately stale fixture, total opt-out (existing behavior):**

```yaml
stale:
  path: ./dogfood/stale-source.md
  audit:
    traps: false
```

## Dogfood follow-up on pickled itself

Once shipped, pickled's own `pickled.yml` can move from total opt-out to fine-grained suppression on `brand.md` and `AGENTS.md`. The trap-id uniqueness migration also gives us a clean reason to consolidate `old_freshness_brand` and `freshness_score` into one trap referenced from both scenarios (the redundancy flagged in `proposals/audit-trap-source-crossref.md` Open Question 3). That cleanup happens in the same PR that ships the feature, so the migration cost is paid exactly once.

## Implementation order

1. Schema: extend `DocSourceEntry.audit.traps` and `ResolvedDocSource.auditTraps` to `boolean | string[]`. Update `normalizeDocSource`.
2. Loader: validate array form, validate listed ids reference declared traps, reject empty arrays, enforce global trap-id uniqueness when any list form is present.
3. Audit: extend `scanSourceTraps` with the skip-set filter (Decision 3).
4. Tests: backward compat with boolean forms, list form skips only listed traps, listed unknown id rejected with helpful message, global uniqueness rejection only triggers when list form is used, empty array rejected.
5. Dogfood: consolidate `old_freshness_brand` and `freshness_score` in pickled.yml; switch `brand.md` and `AGENTS.md` from `false` to targeted lists; keep `stale` on `false`. Run `pickled audit` and confirm zero findings.
6. Release: lead the notes with the dogfood data.

## Explicitly out of scope

- **Per-trap regex consolidation primitives.** This proposal makes the `old_freshness_brand`/`freshness_score` redundancy fixable but does not introduce a "global/reusable trap" schema concept. That would be a larger schema change; revisit if vendors start asking for it.
- **Trap-id renaming across scenarios.** Not introduced; the global uniqueness rule means authors handle renaming with normal config edits.
- **Compound suppression** (e.g., "skip all traps matching regex X"). Listed ids are the only suppression vocabulary. If the trap registry grows large enough to want regex-suppression, that is a follow-up proposal with its own design.

## Open questions

1. **Should the global uniqueness rule apply unconditionally, not just when list form is used?** Strictest answer is yes: cross-scenario duplicate ids are a config smell regardless. The current proposal scopes the new rule narrowly to avoid breaking existing configs that have cross-scenario duplicates (pickled's own `freshness score` traps). If we go unconditional, pickled needs the consolidation in the same PR. Lean toward narrow now, unconditional later.
2. **Should `audit.traps: [...]` accept a wildcard like `"*"`?** Probably not. `true` and `false` already cover the all/nothing endpoints. Wildcards introduce parsing ambiguity for any vendor whose trap id happens to be `*`.
