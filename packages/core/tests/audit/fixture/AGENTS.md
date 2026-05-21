# Test fixture

Reference to a real file: `package.json`.

Reference to a missing file: `does/not/exist.ts`.

Broken @-import: @./missing.md

Run with `bun test:fake` to exercise the unresolved-command path.

Bun built-in subcommand: `bun build` (should not flag).
Cross-PM false equivalent: `npm build` (should flag; npm has no `build` built-in).
