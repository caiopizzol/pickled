"use client";
import { RootProvider } from "fumadocs-ui/provider/next";
import type { ReactNode } from "react";
import SearchDialog from "@/components/search";

export function Provider({ children }: { children: ReactNode }) {
  // pickled.dev is dark-only. Skip Fumadocs' ThemeProvider entirely
  // (theme.enabled: false short-circuits next-themes inside
  // RootProvider) and apply the `dark` class statically on <html> in
  // apps/docs/app/layout.tsx. The toggle is hidden via
  // baseOptions().themeSwitch.enabled = false. Until the landing app
  // learns to be theme-aware, this keeps both surfaces locked dark
  // with no JS toggle and no flash of unstyled light theme.
  return (
    <RootProvider search={{ SearchDialog }} theme={{ enabled: false }}>
      {children}
    </RootProvider>
  );
}
