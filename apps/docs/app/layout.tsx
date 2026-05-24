import type { Metadata } from "next";
import { DM_Sans, JetBrains_Mono, Space_Grotesk } from "next/font/google";
import { Analytics } from "@/components/analytics";
import { Provider } from "@/components/provider";
import "./global.css";
import "./pickled-theme.css";

// Same three fonts the pickled.dev landing uses, exposed as CSS
// variables so the pickled-theme.css token bridge can pick them up.
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-pickled-heading",
});
const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-pickled-body",
});
const jetBrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-pickled-mono",
});

// Head contract for docs.pickled.dev. Mirrors apps/web/index.html so
// the two surfaces share the same favicon set, manifest, title
// grammar (hyphen separator), and brand description. Page-level
// generateMetadata in app/(docs)/[[...slug]]/page.tsx sets per-page
// title (via the template) and a self-canonical URL.
export const metadata: Metadata = {
  metadataBase: new URL("https://docs.pickled.dev"),
  title: { default: "pickled docs", template: "%s - pickled docs" },
  description:
    "Pickled runs real agent questions across a matrix of interfaces, sources, and toolsets, then scores the answers with deterministic checks.",
  alternates: {
    canonical: "/",
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon-16x16.png", type: "image/png", sizes: "16x16" },
      { url: "/favicon-32x32.png", type: "image/png", sizes: "32x32" },
    ],
    apple: { url: "/apple-touch-icon.png", sizes: "180x180" },
  },
  manifest: "/site.webmanifest",
};

export default function Layout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      // `dark` is the single source of truth for the docs theme. The
      // next-themes ThemeProvider is skipped in
      // components/provider.tsx (theme.enabled: false), so Fumadocs'
      // class-based dark styles (Shiki code blocks, sidebar hover,
      // etc.) only kick in because this class is here. If the
      // provider is ever re-enabled, drop this class so it can own
      // the toggling.
      className={`dark ${spaceGrotesk.variable} ${dmSans.variable} ${jetBrainsMono.variable}`}
      suppressHydrationWarning
    >
      <body className="flex flex-col min-h-screen">
        <Provider>{children}</Provider>
        <Analytics />
      </body>
    </html>
  );
}
