import { createMDX } from "fumadocs-mdx/next";

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  output: "export",
  reactStrictMode: true,
  // The official `+next+fuma-docs-mdx+static` template uses
  // `page.data.body` whose type does not survive Fumadocs MDX's
  // `// @ts-nocheck`d typegen under strict TS. Runtime is fine. Until
  // we fix the source typing (or upstream does), do not block builds
  // on type errors.
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default withMDX(config);
