import type { MetadataRoute } from "next";
import { source } from "@/lib/source";

// Pages come from the same Fumadocs loader as generateStaticParams, so the
// sitemap cannot drift from the routes that ship. Host is hard-coded because
// `output: "export"` builds this with no request origin.
const SITE = "https://docs.pickled.dev";

// Required under `output: "export"`, or the export build fails collecting
// /sitemap.xml.
export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  return source.getPages().map((page) => ({
    url: new URL(page.url, SITE).toString(),
    changeFrequency: "weekly",
    priority: page.url === "/" ? 1 : 0.8,
  }));
}
