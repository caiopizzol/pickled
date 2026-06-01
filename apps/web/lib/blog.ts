import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import matter from "gray-matter";

// Posts live in content/blog as MDX with frontmatter. Read at build time
// (static export), so plain node fs is fine.
const BLOG_DIR = join(process.cwd(), "content/blog");

export interface PostFrontmatter {
  title: string;
  description: string;
  date: string;
  updated?: string;
  author: string;
  tags?: string[];
}

export interface Post {
  slug: string;
  frontmatter: PostFrontmatter;
  content: string;
}

export function getPostSlugs(): string[] {
  return readdirSync(BLOG_DIR)
    .filter((f) => f.endsWith(".mdx"))
    .map((f) => f.replace(/\.mdx$/, ""));
}

export function getPost(slug: string): Post {
  const raw = readFileSync(join(BLOG_DIR, `${slug}.mdx`), "utf8");
  const { data, content } = matter(raw);
  // YAML parses a bare ISO date (date: 2026-06-01) into a Date object, which
  // breaks the string-based formatting / RSS / JSON-LD downstream. Normalize
  // date fields back to YYYY-MM-DD strings.
  for (const key of ["date", "updated"]) {
    if (data[key] instanceof Date) {
      data[key] = (data[key] as Date).toISOString().slice(0, 10);
    }
  }
  return { slug, frontmatter: data as PostFrontmatter, content };
}

export function getAllPosts(): Post[] {
  return getPostSlugs()
    .map(getPost)
    .sort((a, b) => (a.frontmatter.date < b.frontmatter.date ? 1 : -1));
}
