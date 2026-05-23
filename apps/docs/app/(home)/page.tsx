"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

// docs.pickled.dev/ is not a real landing page. The landing lives at
// pickled.dev; here we send anyone who hits the root straight into
// the docs. Production traffic gets a 301 via apps/docs/public/_redirects
// (Cloudflare Pages serves it before this HTML), so this client-side
// fallback only fires in local dev and as a safety net.
export default function HomePage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/docs");
  }, [router]);
  return null;
}
