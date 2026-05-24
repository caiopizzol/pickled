"use client";

import { usePathname } from "next/navigation";
import Script from "next/script";
import { useEffect } from "react";

// Same GA4 property as apps/web/index.html so pickled.dev and
// docs.pickled.dev share one funnel. Subdomains of the same root
// domain (pickled.dev) measure cleanly in a single property without
// cross-domain linker config; GA stitches sessions across them as
// long as the cookie domain is set correctly in GA Admin
// (typically "auto").
const GA_ID = "G-EF49SBB7Q7";

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

export function Analytics() {
  const pathname = usePathname();

  // Fumadocs + Next App Router navigation does not reload the page.
  // The gtag.js initial config sets `send_page_view: false`, then we
  // emit a `page_view` event on mount and on every pathname change so
  // route-level views are tracked without double-counting the first
  // page.
  useEffect(() => {
    if (typeof window.gtag !== "function") return;
    window.gtag("event", "page_view", {
      page_path: pathname,
      page_location: window.location.href,
      page_title: document.title,
    });
  }, [pathname]);

  return (
    <>
      <Script
        strategy="afterInteractive"
        src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
      />
      <Script id="gtag-init" strategy="afterInteractive">
        {`
window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${GA_ID}', { send_page_view: false });
        `}
      </Script>
    </>
  );
}
