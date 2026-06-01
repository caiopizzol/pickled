import { ImageResponse } from "next/og";
import { getPost, getPostSlugs } from "@/lib/blog";

export const revalidate = false;

// Mirrors the docs OG route: the trailing "image.png" segment makes the
// emitted static file serve with a real .png extension under output: export.
export function generateStaticParams() {
  return getPostSlugs().map((slug) => ({ slug: [slug, "image.png"] }));
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string[] }> },
) {
  const { slug } = await params;
  const postSlug = slug[0];
  let title = "pickled";
  try {
    title = getPost(postSlug).frontmatter.title;
  } catch {
    // fall back to brand name
  }

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        background: "#0a0a0f",
        padding: "80px",
        fontFamily: "sans-serif",
      }}
    >
      <div
        style={{
          display: "flex",
          color: "#ffffff",
          fontSize: 32,
          fontWeight: 700,
        }}
      >
        pickled
      </div>
      <div
        style={{
          display: "flex",
          color: "#ffffff",
          fontSize: 64,
          fontWeight: 700,
          lineHeight: 1.1,
          letterSpacing: "-0.02em",
        }}
      >
        {title}
      </div>
      <div
        style={{
          display: "flex",
          color: "#00e676",
          fontSize: 28,
          fontWeight: 600,
        }}
      >
        Agent legibility, measured.
      </div>
    </div>,
    { width: 1200, height: 630 },
  );
}
