import type { Metadata } from "next";
import { DM_Sans, JetBrains_Mono, Space_Grotesk } from "next/font/google";
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

// Public canonical origin for OG/Twitter image resolution.
export const metadata: Metadata = {
  metadataBase: new URL("https://docs.pickled.dev"),
  title: { default: "pickled docs", template: "%s · pickled" },
  description:
    "Test what agents actually understand about your product. Pickled runs scenarios across a matrix of interfaces, sources, and toolsets, then scores each cell with deterministic checks.",
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
      </body>
    </html>
  );
}
