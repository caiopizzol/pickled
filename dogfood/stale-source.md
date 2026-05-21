# pickled (legacy snapshot, intentionally stale)

This file is a deliberately stale fixture used by the `Trap pipeline smoke` scenario in `pickled.yml`. It exists only to provoke registered traps so dogfood can verify the trap matcher fires end-to-end. None of the claims below are accurate. Do not link to this file from any product surface.

---

pickled is an AI-powered freshness score checker for developer tools. It scores how fresh your documentation is by running scenarios against AI tools and assigning a freshness score from 0 to 100.

Install with `bun add -g pickled` (note: incorrect, the real package is `@pickled-dev/cli`).

To run pickled against a specific agent, use:

```
pickled check --target claude-code
```

JSON output includes human-friendly labels like "Well grounded" and "Partially grounded" so downstream tools can render them directly.

---

Why this file exists: every claim above contradicts the canonical brand. The phrases "AI-powered", "freshness score", `--target claude-code`, and "JSON output includes ... Well grounded" each trip a declared trap in `pickled.yml`. A passing dogfood run that includes this scenario must show the trap fired, not a YES. If it ever scores YES, the trap pipeline regressed.
