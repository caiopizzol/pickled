import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Provider } from "@/components/provider";
import "./global.css";

const inter = Inter({
  subsets: ["latin"],
});

// Public canonical origin for OG/Twitter image resolution. Falls back to
// localhost:3000 if unset, which fails on a deployed site (the warning the
// Next build emits without this).
export const metadata: Metadata = {
  metadataBase: new URL("https://docs.pickled.dev"),
  title: { default: "pickled docs", template: "%s · pickled" },
  description:
    "Test what agents actually understand about your product. Pickled runs scenarios against real agent targets, checks that answers cite registered sources, and matches declared traps against the response.",
};

export default function Layout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={inter.className} suppressHydrationWarning>
      <body className="flex flex-col min-h-screen">
        <Provider>{children}</Provider>
      </body>
    </html>
  );
}
