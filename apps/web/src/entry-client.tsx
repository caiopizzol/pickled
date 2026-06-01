import { StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import "./styles/global.css";
import "./styles/components.css";
import App from "./App.tsx";

// hydrateRoot (not createRoot): prerender.ts ships server-rendered markup
// inside #root, so React must hydrate it rather than replace it.
const root = document.getElementById("root");
if (root) {
  hydrateRoot(
    root,
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
