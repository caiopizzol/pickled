import type { Metadata } from "next";
import { getAllPosts } from "@/lib/blog";
import { Footer, Nav } from "../../src/components";
import "./blog.css";

export const metadata: Metadata = {
  title: "Blog",
  description:
    "Essays on agent legibility: testing what AI agents actually understand about your product.",
  alternates: { canonical: "/blog" },
};

export default function BlogIndex() {
  const posts = getAllPosts();
  return (
    <>
      <Nav />
      <main className="blog-wrap">
        <h1 className="post-title">Blog</h1>
        <ul className="blog-list">
          {posts.map((post) => (
            <li key={post.slug} className="blog-list-item">
              <a href={`/blog/${post.slug}`}>{post.frontmatter.title}</a>
              <p>{post.frontmatter.description}</p>
            </li>
          ))}
        </ul>
      </main>
      <Footer />
    </>
  );
}
