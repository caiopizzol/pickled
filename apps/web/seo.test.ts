import { expect, test } from "bun:test";
import { join } from "node:path";

// These lock the SEO contract for the marketing site at the source level
// (Vite copies index.html and public/ verbatim into dist). The sitemap
// assertion specifically guards the regression where Vite's SPA catch-all
// served index.html for /sitemap.xml.
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

test("og-image asset exists and is a real card, not a placeholder", async () => {
  const file = Bun.file(join(import.meta.dir, "public/og-image.png"));
  expect(await file.exists()).toBe(true);
  expect((await file.arrayBuffer()).byteLength).toBeGreaterThan(10_000);
});
