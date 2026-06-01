import { StrictMode } from "react";
import { renderToString } from "react-dom/server";
import App from "./App.tsx";

// Prerender entry: prerender.ts calls render() and injects the markup into
// dist/index.html so the homepage ships hero copy, CTAs, and crawlable links
// before JS runs. entry-client.tsx hydrates the same tree.
export function render(): string {
  return renderToString(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
