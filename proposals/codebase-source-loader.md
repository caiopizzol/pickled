# Proposal: codebase source loader

**Status:** draft, no implementation
**Motivated by:** today's `docs.sources` only loads single files or single URLs. The first source-loader expansion (issue #5) is the codebase loader, which expands a glob into one logical source whose content is the registered code-resident text. Vendors testing whether agents understand their JSDoc, inline comments, agent-doc trees, or examples directory have no first-class way to register them today: they would have to copy-paste hundreds of files into one or pre-concatenate via a build step. The `DocSourceType` enum at `packages/config/src/types.ts:144` already declares `"codebase"` as a valid type; the loader at `packages/core/src/sources.ts:62` rejects it.
**Decision needed:** schema shape, citation semantics, audit interaction, size limits, glob behavior, what counts as one source.

## Problem

A scenario like *"How does the trap matcher handle regex with case-insensitive flags?"* tests knowledge that lives in `packages/core/src/scorers/traps.ts` and its tests. Today there is no way to register the source files as a `docs.sources` entry. Vendors that care about whether agents understand their *code* (not just their docs) have to either copy the file content into a one-off `.txt` or accept that pickled cannot evaluate this class of question.

The codebase loader closes that gap by accepting a glob pattern and treating the matched files as the source content.

## Proposal

A new `docs.sources` entry type, declared via the object form with explicit `type: codebase`:

```yaml
docs:
  sources:
    core_jsdoc:
      type: codebase
      path: "packages/core/src/**/*.ts"
    agent_docs:
      type: codebase
      path: "**/CLAUDE.md"
```

Codebase sources are always explicit. String-form `docs.sources` entries stay as "load exactly this file or URL"; they do not silently become globs based on character content. The slight verbosity of the object form is the price of an unambiguous registered-source contract.

When a source has `type: codebase`, the loader:

1. Walks the glob from the project root using Bun's `Glob`.
2. Reads each matched file. Concatenates the contents with a clear file-separator header so the agent can see which file each block came from.
3. Returns one `ResolvedDocSource` per declared source id. The `content` is the concatenated text; the `name` is `<n> files in <glob>` (e.g., `12 files in packages/core/src/**/*.ts`).

Sub-source attribution (one source id per matched file) is **explicitly deferred to v2**. v1 is one source per glob, one content blob, one citation. The win is that the loader exists; the cost is that the agent cites the glob name, not the specific file. See Open Question 1 for why.

## Decision 1: schema shape

**Recommendation:** object form with `type: codebase`. Explicit always. String-form `docs.sources` entries are never auto-detected as codebase sources.

A previous draft proposed auto-detecting glob characters (`*` or `?`) in string-form values, on the theory that `agent_docs: "**/CLAUDE.md"` is convenient. Rejected: auto-detection weakens the "string means load exactly this file or URL" half of the existing registered-source contract. It creates odd edge cases (literal `*` in filenames) and forces every future source-type addition to think about whether some character pattern should silently change the loader's behavior. The explicit object form is one extra line and removes the ambiguity entirely.

Alternative also considered and rejected: separate top-level fields like `docs.codebase:` parallel to `docs.sources:`. Rejected because it splits the registry and breaks the "every source has an id" invariant the existing citation contract depends on.

## Decision 2: citation semantics

**Recommendation:** the source is one id. Citation against the source id matches regardless of which file in the glob contributed the answer. Sub-source attribution (per-file citation) is deferred to v2.

Why: per-file sub-sources require either (a) the agent learning a new citation grammar like `[core_jsdoc:packages/core/src/check.ts]`, or (b) automatic per-file id generation that bloats the registered-id list. Both are real design changes that should not block the v1 ship. For v1, the codebase source behaves like a single big source whose content happens to come from many files.

This means: in compare-surfaces mode, surface `[core_jsdoc]` is one surface even when the glob matches 30 files. That is the right unit for the first ship; finer-grained comparison is the v2 win.

## Decision 3: audit interaction

**Recommendation:** the audit's trap cross-reference rule scans each matched file individually. Findings report `<source_id>:<relative_path>:L<line>` so the user can navigate to the specific file. The audit treats the codebase source as a virtual aggregate for citation purposes (Decision 2) but as N individual files for trap-scanning purposes.

Why the split: trap matching wants per-file precision so the audit can point at the exact line. Citation scoring works on the source id and does not need per-file granularity. The audit's existing `SourceTrapMatch` carries `sourcePath`; it just becomes `<glob source>:<resolved file path>` for codebase findings.

The `audit.traps: false` and `audit.traps: [<trap_id>]` suppression forms apply to the codebase source as a whole. Per-file suppression inside a codebase source is deferred.

## Decision 4: size handling

**Recommendation:** soft cap at 256 KB total concatenated content per codebase source, configurable via `maxBytes` on the source entry. Hard cap at 4 MB. Above hard cap the loader throws so vendors do not silently feed multi-megabyte prompts to an agent.

```yaml
docs:
  sources:
    big_codebase:
      type: codebase
      path: "src/**/*.ts"
      maxBytes: 524288   # opt-in to 512 KB
```

Why caps: the LLM API call cost scales with input tokens. A directory glob expanding to 10 MB of JSDoc would balloon the prompt. The soft cap (256 KB) is roughly 50K tokens; the hard cap (4 MB) is the API request limit territory. The default is conservative; vendors with large codebases tune it.

Behavior at the soft cap: the loader emits a warning to `onProgress` (so progress output flags it) but still loads. At the hard cap: throw.

## Decision 5: glob behavior, excludes, symlinks, and root containment

**Recommendation:** Bun's `Glob` from the project root (the directory containing `pickled.yml`), with the following safety defaults:

- `onlyFiles: true` - skip directories in matches.
- `followSymlinks: false` - do not traverse symlinks. The audit's `scan.ts:53` uses the same default for the same reason: surprising symlink traversal pulls in content the vendor did not register.
- Glob patterns containing `..` segments are rejected by the loader. The codebase loader does not escape the project root.

Excludes via a per-source `exclude` list:

```yaml
docs:
  sources:
    src:
      type: codebase
      path: "packages/**/src/**/*.ts"
      exclude: ["**/*.test.ts", "**/*.spec.ts"]
```

The loader runs the include glob, then filters out anything matching any exclude pattern. No magic `.gitignore` integration; vendors who want that add the patterns explicitly. Out of scope to make `.gitignore` opt-in.

Conservative defaults are deliberate. Vendors who legitimately need symlink traversal (e.g., monorepos with `node_modules`-style hoisted layouts) can revisit in v2 with an explicit opt-in like `followSymlinks: true` per source. v1 keeps loading boring.

## Decision 6: file ordering

**Recommendation:** sort matched files lexicographically by relative path before concatenation. Determinism is required so the same config + same files always produces the same content (otherwise the LLM call is non-reproducible).

## What does NOT change

- The existing file and URL loaders. Codebase is a new branch in `fetchSource`, not a replacement.
- Citation scoring. Same `## Sources` parsing, same required-source check. The agent cites `core_jsdoc` as one id.
- Compare-surfaces mode. A codebase source can be in a `compareSurfaces` list just like any other source id.
- Audit's structural rules (broken refs, line budgets, pair classification). They operate on agent-doc files, not on codebase sources.

## Examples

**Register all JSDoc in packages/core:**

```yaml
docs:
  sources:
    core_jsdoc:
      type: codebase
      path: "packages/core/src/**/*.ts"
      exclude: ["**/*.test.ts"]

scenarios:
  - name: "Trap matcher"
    prompt: "How does pickled's trap matcher handle regex flags?"
    requiredSources: [core_jsdoc]
```

**Aggregate all CLAUDE.md files for an agent-context test:**

```yaml
docs:
  sources:
    agent_docs:
      type: codebase
      path: "**/CLAUDE.md"

scenarios:
  - name: "Per-package agent guidance"
    prompt: "What does pickled's per-package CLAUDE.md tell new agents about boundaries?"
    requiredSources: [agent_docs]
```

**Compare surface across README vs codebase:**

```yaml
scenarios:
  - name: "Install instructions"
    prompt: "How do I install pickled?"
    requiredSources: [readme]
    compareSurfaces:
      - [readme]
      - [core_jsdoc]      # answer should fail; install is not in JSDoc
      - [readme, core_jsdoc]
```

## JSON output

`ResolvedDocSource` for a codebase source gains an optional `matchedFiles: string[]` field listing the relative paths the glob expanded to. Consumers that want to know which files contributed can read it. The existing `content`, `name`, `type`, and `auditTraps` fields keep their current meaning.

```jsonc
{
  "id": "core_jsdoc",
  "source": "packages/core/src/**/*.ts",
  "name": "12 files in packages/core/src/**/*.ts",
  "type": "codebase",
  "content": "...concatenated...",
  "matchedFiles": ["packages/core/src/check.ts", "packages/core/src/sources.ts", ...],
  "auditTraps": true
}
```

## Out of scope

- **Per-file sub-sources.** v1 is one source per glob. Sub-source citation grammar (e.g., `[core_jsdoc:check.ts]`) is a real product extension; revisit after v1 produces evidence of needing finer-grained citation.
- **`.gitignore` integration.** Magic. Users add excludes explicitly.
- **Watching for file changes.** The loader reads at scenario-run time. No live-watch.
- **Recursive globs that escape the project root.** Loader rejects glob patterns with `..` segments.
- **Binary file detection.** v1 assumes UTF-8. Binary files matched by an overly-broad glob will produce gibberish content; vendors fix their glob.

## Implementation order

1. Schema: add `type: codebase`, `exclude?: string[]`, `maxBytes?: number` to `DocSourceEntry`. Update loader validation: require `path` for codebase, reject `..` segments in the pattern.
2. Loader: new branch in `fetchSource` for `type: codebase`. Walks the glob via Bun's `Glob` with `onlyFiles: true` and `followSymlinks: false`, reads each file, sorts deterministically by relative path, concatenates with file-separator headers, returns one `ResolvedDocSource` with `matchedFiles` populated.
3. Size enforcement: soft cap with warning to `onProgress`, hard cap throws. Both configurable via `maxBytes`.
4. Audit interaction: extend `scanSourceTraps` to scan each matched file when the source has `matchedFiles`. Findings carry the per-file relative path in `sourcePath`.
5. Tests: glob expansion, file ordering determinism, soft and hard cap, exclude patterns, audit per-file findings, citation against parent id, compare-surfaces interop, malformed glob rejection (including `..` rejection), symlink-not-followed.
6. Dogfood: add one codebase source to `pickled.yml` (likely `core_src: { type: codebase, path: "packages/core/src/**/*.ts" }`) and one scenario that exercises it.
7. Docs: extend `apps/cli/README.md` Targets section and root `README.md` with the codebase shape and the explicit-type requirement.

## Open questions

1. **Sub-source attribution.** v1 punts on per-file citation. The v2 question: do we generate ids like `core_jsdoc:packages/core/src/check.ts`, or invent a separate citation grammar? Wait for evidence from v1 use before designing.
2. **Should `matchedFiles` be the audit's scoping unit even when `audit.traps: ['<id>']` is set?** Yes, but the suppression list is still source-level (all matched files share the same suppression). Per-file suppression inside a codebase source is its own design.
3. **What is the file-separator format in concatenated content?** Sketched as a header line like `// === packages/core/src/check.ts ===`. Pick during implementation; tests will pin the exact format.
4. ~~**Symlinks inside the glob.**~~ Resolved in Decision 5: v1 does NOT follow symlinks. Default is `followSymlinks: false`, mirroring the audit's `scan.ts:53` pattern. Vendors who need traversal can opt in via a per-source field in v2.
