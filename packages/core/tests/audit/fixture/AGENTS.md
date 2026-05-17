# Test fixture

Reference to a real file: `package.json`.

Reference to a missing file: `does/not/exist.ts`.

Broken @-import: @./missing.md

Run with `bun test:fake` to exercise the unresolved-command path.
