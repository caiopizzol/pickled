import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import { appName, gitConfig } from "./shared";

// Same logo treatment as apps/web/src/components/Logo.tsx: pickle emoji
// + lowercase wordmark. AGENTS.md keeps this as the established chrome
// for the nav logo across both surfaces.
function PickledLogo() {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.5rem",
        fontWeight: 700,
        letterSpacing: "-0.01em",
      }}
    >
      <span aria-hidden="true">🥒</span>
      <span>{appName}</span>
    </span>
  );
}

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: <PickledLogo />,
      // docs.pickled.dev/ IS the docs root after the URL flatten;
      // logo points to the subdomain root.
      url: "/",
    },
    // Same nav vocabulary as apps/web Nav.tsx: text links for Docs,
    // Website, and GitHub. We deliberately drop `githubUrl` (which
    // would render a GitHub ICON in the secondary slot) so all three
    // links share the same visual treatment.
    links: [
      { text: "Docs", url: "/" },
      { text: "Website", url: "https://pickled.dev", external: true },
      {
        text: "GitHub",
        url: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
        external: true,
      },
    ],
    // pickled.dev is dark-only and the docs site is locked dark via
    // the static `class="dark"` on <html> (apps/docs/app/layout.tsx).
    // Hide the theme toggle so the chrome does not advertise a
    // control that does nothing.
    themeSwitch: { enabled: false },
  };
}
