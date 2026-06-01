import { expect, test } from "bun:test";
import { join } from "node:path";

// These lock the SEO contract at the source level: public/ ships verbatim
// and index.html's <head> is preserved through the build. The homepage
// <body> is prerendered and validated in prerender.ts instead (artifact
// level, since the rendered markup only exists after the build, and `verify`
// runs tests before that build). The sitemap assertion guards the regression
// where Vite's SPA catch-all served index.html for /sitemap.xml.
const read = (p: string) => Bun.file(join(import.meta.dir, p)).text();

test("sitemap.xml is XML, not the SPA shell", async () => {
  const xml = await read("public/sitemap.xml");
  expect(xml).toContain("<urlset");
  expect(xml).toContain("<loc>https://pickled.dev/</loc>");
  expect(xml.toLowerCase()).not.toContain("<!doctype html>");
});

test("robots.txt advertises the sitemap", async () => {
  const robots = await read("public/robots.txt");
  expect(robots).toContain("Sitemap: https://pickled.dev/sitemap.xml");
});

test("homepage head carries canonical, description, and social cards", async () => {
  const html = await read("index.html");
  expect(html).toContain('rel="canonical"');
  expect(html).toContain('name="description"');
  expect(html).toContain('property="og:title"');
  expect(html).toContain('content="https://pickled.dev/og-image.png"');
  expect(html).toContain('name="twitter:card" content="summary_large_image"');
});

test("homepage carries SoftwareApplication structured data", async () => {
  const html = await read("index.html");
  expect(html).toContain('type="application/ld+json"');
  expect(html).toContain('"@type": "SoftwareApplication"');
});

test("fonts load without blocking render", async () => {
  const html = await read("index.html");
  const css = await read("src/styles/global.css");
  // The font stylesheet must be the non-blocking print-swap <link>, and the
  // render-blocking CSS @import must be gone.
  expect(html).toContain("onload=\"this.media='all'\"");
  expect(css).not.toContain("fonts.googleapis.com");
});

test("sans fonts have metric-matched fallbacks to hold layout on swap", async () => {
  const css = await read("src/styles/global.css");
  const tokens = await read("src/styles/tokens.css");
  expect(css).toContain("size-adjust:");
  expect(css).toContain('font-family: "Space Grotesk Fallback"');
  expect(tokens).toContain('"Space Grotesk Fallback"');
  expect(tokens).toContain('"DM Sans Fallback"');
});

test("og-image asset exists and is a real card, not a placeholder", async () => {
  const file = Bun.file(join(import.meta.dir, "public/og-image.png"));
  expect(await file.exists()).toBe(true);
  expect((await file.arrayBuffer()).byteLength).toBeGreaterThan(10_000);
});
