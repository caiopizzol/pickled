import { expect, test } from "bun:test";
import { join } from "node:path";

// Source-level SEO contract for the Next marketing app. `verify` runs tests
// before the build, so these assert on source, not the static `out/`. Next's
// own build is what proves the routes render (sitemap.ts, OG route, metadata).
const read = (p: string) => Bun.file(join(import.meta.dir, p)).text();

test("robots.txt advertises the sitemap", async () => {
  const robots = await read("public/robots.txt");
  expect(robots).toContain("Sitemap: https://pickled.dev/sitemap.xml");
});

test("sitemap is generated from blog content, not a static file", async () => {
  const src = await read("app/sitemap.ts");
  expect(src).toContain("getPostSlugs");
  expect(src).toContain('export const dynamic = "force-static"');
});

test("layout carries canonical, social cards, and SoftwareApplication JSON-LD", async () => {
  const layout = await read("app/layout.tsx");
  expect(layout).toContain("canonical:");
  expect(layout).toContain('card: "summary_large_image"');
  expect(layout).toContain("/og-image.png");
  expect(layout).toContain('"@type": "SoftwareApplication"');
});

test("blog posts emit BlogPosting JSON-LD and per-post OG", async () => {
  const post = await read("app/blog/[slug]/page.tsx");
  expect(post).toContain('"@type": "BlogPosting"');
  expect(post).toContain("/og/blog/");
});

test("every blog post has the required frontmatter contract", async () => {
  const { readdirSync } = await import("node:fs");
  const dir = join(import.meta.dir, "content/blog");
  const files = readdirSync(dir).filter((f) => f.endsWith(".mdx"));
  expect(files.length).toBeGreaterThan(0);
  for (const f of files) {
    const raw = await Bun.file(join(dir, f)).text();
    for (const key of ["title:", "description:", "date:", "author:"]) {
      expect(raw).toContain(key);
    }
  }
});

test("blog posts have deterministic editorial order", async () => {
  const loader = await read("lib/blog.ts");
  expect(loader).toContain("frontmatter.order");

  const orderedSlugs = [
    "testing-public-product-context",
    "testing-llms-txt",
    "no-tool-web-mcp-agent-answers",
    "deterministic-agent-evals",
    "agent-evals-in-ci",
    "testing-agents-md-claude-md",
  ];

  for (const [index, slug] of orderedSlugs.entries()) {
    const raw = await read(`content/blog/${slug}.mdx`);
    expect(raw).toContain(`order: ${index + 1}`);
  }
});

test("homepage OG asset exists and is a real card", async () => {
  const file = Bun.file(join(import.meta.dir, "public/og-image.png"));
  expect(await file.exists()).toBe(true);
  expect((await file.arrayBuffer()).byteLength).toBeGreaterThan(10_000);
});
