import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MDXRemote } from "next-mdx-remote/rsc";
import { getPost, getPostSlugs } from "@/lib/blog";
import { Footer, Nav } from "../../../src/components";
import "../blog.css";

const SITE = "https://pickled.dev";

export function generateStaticParams() {
  return getPostSlugs().map((slug) => ({ slug }));
}

function load(slug: string) {
  try {
    return getPost(slug);
  } catch {
    return null;
  }
}

export async function generateMetadata(props: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await props.params;
  const post = load(slug);
  if (!post) return {};
  const { title, description } = post.frontmatter;
  const url = `${SITE}/blog/${slug}`;
  return {
    title,
    description,
    alternates: { canonical: `/blog/${slug}` },
    openGraph: {
      type: "article",
      url,
      title,
      description,
      images: [`/og/blog/${slug}/image.png`],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [`/og/blog/${slug}/image.png`],
    },
  };
}

export default async function Post(props: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await props.params;
  const post = load(slug);
  if (!post) notFound();
  const { title, description, date, updated, author } = post.frontmatter;
  const url = `${SITE}/blog/${slug}`;

  const jsonLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: title,
    description,
    datePublished: date,
    dateModified: updated ?? date,
    author: { "@type": "Person", name: author },
    image: `${SITE}/og/blog/${slug}/image.png`,
    url,
    mainEntityOfPage: url,
  }).replace(/</g, "\\u003c");

  const displayDate = new Date(`${date}T00:00:00Z`).toLocaleDateString(
    "en-US",
    {
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: "UTC",
    },
  );

  return (
    <>
      <Nav />
      <main className="blog-wrap">
        <a className="blog-back" href="/blog">
          ← Blog
        </a>
        <p className="post-meta">
          {displayDate} · {author}
        </p>
        <h1 className="post-title">{title}</h1>
        <article className="prose">
          <MDXRemote source={post.content} />
        </article>
        <script
          type="application/ld+json"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: serialized JSON-LD with < escaped above
          dangerouslySetInnerHTML={{ __html: jsonLd }}
        />
      </main>
      <Footer />
    </>
  );
}
