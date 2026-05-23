# docs

Pickled's public documentation site. Static Next.js + Fumadocs UI, deployed to Cloudflare Pages at `docs.pickled.dev` (once the custom domain is wired).

The site exposes:

- `/` and `/docs/*` for humans.
- `/llms.txt` and `/llms-full.txt` for agents that ingest docs ahead of time.
- `/llms.mdx/docs/<slug>/content.md` for per-page Markdown fetching.
- `/og/docs/<slug>/image.png` for Open Graph cards.

The site doubles as a real public source for the matrix dogfood: scenarios in the root `pickled.yml` can register the deployed URLs and test what agents say about Pickled when the docs are the only source they can read.

## Scripts

```bash
bun run --cwd apps/docs dev       # local dev server
bun run --cwd apps/docs build     # static export to apps/docs/out
bun run --cwd apps/docs preview   # serve the built site
bun run --cwd apps/docs deploy    # build + wrangler pages deploy
```

## Project layout

- `content/docs/*.mdx` - the docs themselves. Frontmatter follows `pageSchema` from `fumadocs-core/source/schema`.
- `lib/source.ts` - content source adapter for the Fumadocs loader.
- `lib/shared.ts` - project-wide config (app name, GitHub repo, route bases).
- `lib/layout.shared.tsx` - shared layout options for the docs and home sections.
- `app/(home)/` - landing page route group.
- `app/docs/` - docs section (sidebar layout + `[[...slug]]` page).
- `app/llms.txt/route.ts`, `app/llms-full.txt/route.ts`, `app/llms.mdx/docs/[[...slug]]/route.ts` - agent-discovery endpoints generated from the same MDX source.
- `app/api/search/route.ts` - search index endpoint.

## Notes

- `next.config.mjs` sets `typescript.ignoreBuildErrors: true` because the official Fumadocs static template uses `page.data.body` whose type does not survive Fumadocs MDX's `// @ts-nocheck` typegen under strict TS. Runtime is fine; revisit once upstream tightens the typing.
- The build output goes to `out/` (Next.js static export default). The `deploy` script ships that directory to Cloudflare Pages as the `pickled-docs` project.
