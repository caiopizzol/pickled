import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
  MarkdownCopyButton,
  ViewOptionsPopover,
} from "fumadocs-ui/layouts/docs/page";
import { createRelativeLink } from "fumadocs-ui/mdx";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getMDXComponents } from "@/components/mdx";
import { gitConfig } from "@/lib/shared";
import { getPageImage, getPageMarkdownUrl, source } from "@/lib/source";

export default async function Page(props: PageProps<"/[[...slug]]">) {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  const MDX = page.data.body;
  const markdownUrl = getPageMarkdownUrl(page).url;

  // Structured data built from the page's own route data so it can never
  // drift from the rendered page. Escape `<` so a title or description can't
  // break out of the script tag. Dual ["TechArticle", "Article"] type because
  // Google's Article rich result only recognizes Article/NewsArticle/
  // BlogPosting, not the more accurate TechArticle alone.
  const pageUrl = new URL(page.url, "https://docs.pickled.dev").toString();
  const graph: object[] = [
    {
      "@type": ["TechArticle", "Article"],
      headline: page.data.title,
      description: page.data.description,
      url: pageUrl,
      isPartOf: {
        "@type": "WebSite",
        name: "pickled docs",
        url: "https://docs.pickled.dev/",
      },
    },
  ];
  // A BreadcrumbList needs at least two ListItems to be valid (Google), so
  // only non-root pages get one: Docs > <page>. The root would be a single
  // self-referential item, which is invalid.
  if (page.url !== "/") {
    graph.push({
      "@type": "BreadcrumbList",
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: "Docs",
          item: "https://docs.pickled.dev/",
        },
        {
          "@type": "ListItem",
          position: 2,
          name: page.data.title,
          item: pageUrl,
        },
      ],
    });
  }
  const jsonLd = JSON.stringify({
    "@context": "https://schema.org",
    "@graph": graph,
  }).replace(/</g, "\\u003c");

  return (
    <DocsPage toc={page.data.toc} full={page.data.full}>
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: serialized JSON-LD with < escaped above
        dangerouslySetInnerHTML={{ __html: jsonLd }}
      />
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription className="mb-0">
        {page.data.description}
      </DocsDescription>
      <div className="flex flex-row gap-2 items-center border-b pb-6">
        <MarkdownCopyButton markdownUrl={markdownUrl} />
        <ViewOptionsPopover
          markdownUrl={markdownUrl}
          githubUrl={`https://github.com/${gitConfig.user}/${gitConfig.repo}/blob/${gitConfig.branch}/apps/docs/content/docs/${page.path}`}
        />
      </div>
      <DocsBody>
        <MDX
          components={getMDXComponents({
            // this allows you to link to other pages with relative file paths
            a: createRelativeLink(source, page),
          })}
        />
      </DocsBody>
    </DocsPage>
  );
}

export async function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata(
  props: PageProps<"/[[...slug]]">,
): Promise<Metadata> {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  return {
    title: page.data.title,
    description: page.data.description,
    // Self-canonical so search engines treat each docs page as the
    // authoritative URL for its content, not the root layout's "/".
    alternates: {
      canonical: page.url,
    },
    openGraph: {
      images: getPageImage(page).url,
    },
  };
}
