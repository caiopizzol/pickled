import type { ResolvedDocSource } from "@pickled-dev/config";
import type { ExpectedDetail } from "./expected.js";

/**
 * Verify that values the vendor declared in `expected.symbols` and
 * `expected.paths` actually exist in the registered codebase source(s).
 *
 * The vendor declares; pickled checks. This catches the class of
 * vendor-side bug where a scenario asserts the agent should mention
 * `registerToolbarButtonn` (typo) or `src/typo.ts`, but the substring
 * happens to be absent from the agent's response too, so the substring
 * verdict passes silently while the declared value is fictional.
 *
 * Match shape:
 * - **symbols**: substring presence in the concatenated text of every
 *   codebase source's content. The same matcher as the prose substring
 *   check; a symbol that appears only in a comment counts as present.
 *   Honest claim is "the symbol literally appears in your codebase,"
 *   not "the symbol is a real exported name." (AST-aware checking is
 *   future work.)
 * - **paths**: exact-equal OR path-suffix match against any codebase
 *   source's `matchedFiles` entries. So a vendor can write
 *   `src/editor/toolbar.ts` and it matches a file actually loaded as
 *   `packages/editor/src/editor/toolbar.ts`. Reduces friction with
 *   monorepos.
 *
 * Mutates the input `detail` in place: sets `existsInCodebase` on each
 * `CheckResult` in the `symbols` and `paths` groups. When no codebase
 * source is registered, every value is marked `null` (distinguishes
 * "not checked" from "checked and missing"). Other groups
 * (`includes`/`excludes`/`options`/`constraints`) are left untouched -
 * existence is meaningless for those.
 *
 * The cell verdict is NOT changed by existence; the call site uses the
 * existence flags only to surface a hygiene note in the cell reason
 * and to ship the structured data in the JSON receipt for the future
 * readiness reporter.
 */
export function verifyExpectedExistence(
  detail: ExpectedDetail,
  docs: readonly ResolvedDocSource[],
): void {
  const codebases = docs.filter((d) => d.type === "codebase");
  if (codebases.length === 0) {
    // No codebase source registered. Mark every declared symbol/path
    // as "not checked" so the receipt can distinguish this case from
    // a real existence failure.
    for (const c of detail.symbols) c.existsInCodebase = null;
    for (const c of detail.paths) c.existsInCodebase = null;
    return;
  }
  const combinedContent = codebases.map((c) => c.content).join("\n");
  for (const c of detail.symbols) {
    c.existsInCodebase = combinedContent.includes(c.value);
  }
  const allFiles = codebases.flatMap((c) => c.matchedFiles ?? []);
  for (const c of detail.paths) {
    c.existsInCodebase = allFiles.some(
      (f) => f === c.value || f.endsWith(`/${c.value}`),
    );
  }
}

/**
 * Build the per-group hygiene notes for a cell's reason string. Returns
 * up to two entries (one per group with at least one declared value
 * missing from the codebase). Empty array when no values were declared,
 * when no codebase source is registered, or when every declared value
 * exists.
 *
 * Called by the cell scorer after the substring/expected note, so the
 * reason reads, e.g.:
 *   "missing options: \"tooltip\" | declared symbols missing from codebase: \"registerToolbarButtonn\""
 */
export function formatExistenceNotes(detail: ExpectedDetail): string[] {
  const notes: string[] = [];
  for (const group of ["symbols", "paths"] as const) {
    const missing = detail[group]
      .filter((c) => c.existsInCodebase === false)
      .map((c) => `"${c.value}"`);
    if (missing.length > 0) {
      notes.push(
        `declared ${group} missing from codebase: ${missing.join(", ")}`,
      );
    }
  }
  return notes;
}
