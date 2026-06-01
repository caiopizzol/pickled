import { getAllPosts } from "@/lib/blog";

const SITE = "https://pickled.dev";

export const dynamic = "force-static";

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function GET() {
  const items = getAllPosts()
    .map((post) => {
      const url = `${SITE}/blog/${post.slug}`;
      const pubDate = new Date(
        `${post.frontmatter.date}T00:00:00Z`,
      ).toUTCString();
      return `    <item>
      <title>${escapeXml(post.frontmatter.title)}</title>
      <link>${url}</link>
      <guid>${url}</guid>
      <description>${escapeXml(post.frontmatter.description)}</description>
      <pubDate>${pubDate}</pubDate>
    </item>`;
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>pickled blog</title>
    <link>${SITE}/blog</link>
    <description>Essays on agent legibility: testing what AI agents actually understand about your product.</description>
${items}
  </channel>
</rss>
`;

  return new Response(xml, {
    headers: { "Content-Type": "application/xml" },
  });
}
