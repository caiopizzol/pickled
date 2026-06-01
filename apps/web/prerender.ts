import { render } from "./.prerender/entry-server.js";

// Run after `vite build` (client) and `vite build --ssr` (.prerender/). Inject
// the server-rendered tree into the built template so dist/index.html is not a
// bare #root shell.
const file = "dist/index.html";
const template = await Bun.file(file).text();
const appHtml = render();

const marker = "<!--app-html-->";
const html = template.includes(marker)
  ? template.replace(marker, appHtml)
  : template.replace(
      '<div id="root"></div>',
      `<div id="root">${appHtml}</div>`,
    );

// Fail the build if the homepage did not actually prerender. A silent regress
// to a bare #root is the exact failure this whole step exists to prevent.
for (const needle of [
  "<h1",
  "Test what agents",
  "github.com/caiopizzol/pickled",
]) {
  if (!html.includes(needle)) {
    throw new Error(`prerender: expected ${JSON.stringify(needle)} in ${file}`);
  }
}

await Bun.write(file, html);
console.log(`prerendered ${file} (${appHtml.length} chars of markup)`);
