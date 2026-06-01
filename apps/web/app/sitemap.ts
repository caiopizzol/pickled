import type { MetadataRoute } from "next";
import { getPostSlugs } from "@/lib/blog";

const SITE = "https://pickled.dev";

// Replaces the old static public/sitemap.xml; now generated so blog posts
// stay in sync with content/blog. force-static is required under output: export.
export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const posts = getPostSlugs().map((slug) => ({
    url: `${SITE}/blog/${slug}`,
    changeFrequency: "monthly" as const,
    priority: 0.8,
  }));
  return [
    { url: `${SITE}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE}/blog`, changeFrequency: "weekly", priority: 0.7 },
    ...posts,
  ];
}
