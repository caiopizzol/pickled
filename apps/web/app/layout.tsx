import type { Metadata } from "next";
import { DM_Sans, JetBrains_Mono, Space_Grotesk } from "next/font/google";
import Script from "next/script";
import "../src/styles/global.css";
import "../src/styles/components.css";

// next/font self-hosts these and generates metric-matched fallbacks, so the
// fonts no longer render-block and there is no swap reflow (this replaces the
// manual size-adjust @font-face the Vite build used). tokens.css reads these
// CSS variables.
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-space-grotesk",
});
const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-dm-sans",
});
const jetBrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-jetbrains-mono",
});

const description =
  "Pickled runs real agent questions across a matrix of interfaces, sources, and toolsets, then scores the answers with deterministic checks.";
const title = "pickled - Test what agents actually understand";

export const metadata: Metadata = {
  metadataBase: new URL("https://pickled.dev"),
  title: { default: title, template: "%s - pickled" },
  description,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: "https://pickled.dev/",
    siteName: "pickled",
    title,
    description,
    images: [{ url: "/og-image.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/og-image.png"],
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

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "pickled",
  applicationCategory: "DeveloperApplication",
  operatingSystem: "macOS, Linux, Windows",
  description,
  url: "https://pickled.dev/",
  codeRepository: "https://github.com/caiopizzol/pickled",
  downloadUrl: "https://www.npmjs.com/package/@pickled-dev/cli",
  license: "https://opensource.org/licenses/MIT",
  isAccessibleForFree: true,
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  author: { "@type": "Person", name: "Caio Pizzol" },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${spaceGrotesk.variable} ${dmSans.variable} ${jetBrainsMono.variable}`}
    >
      <body>
        {children}
        <script
          type="application/ld+json"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: static JSON-LD object, no user input
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        <Script
          src="https://www.googletagmanager.com/gtag/js?id=G-EF49SBB7Q7"
          strategy="afterInteractive"
        />
        <Script id="gtag-init" strategy="afterInteractive">
          {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', 'G-EF49SBB7Q7');`}
        </Script>
      </body>
    </html>
  );
}
