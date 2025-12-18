import "./polyfills";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { TonConnectUIProvider } from "@tonconnect/ui-react";

import "./index.css";
import App from "./App.tsx";
import { AuthProvider } from "./auth/AuthProvider";
import { env } from "./lib/env";

// Convert relative manifest URL to absolute (required by TonConnect SDK)
function getManifestUrl(): string {
  const url = env.TONCONNECT_MANIFEST_URL;
  if (!url) {
    // Fallback for local development
    return `${window.location.origin}/tonconnect-manifest.json`;
  }
  if (url.startsWith("/")) {
    return `${window.location.origin}${url}`;
  }
  return url;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TonConnectUIProvider
      manifestUrl={getManifestUrl()}
      walletsRequiredFeatures={{ signData: { types: ["text"] } }}
    >
      <AuthProvider>
        <HashRouter>
          <App />
        </HashRouter>
      </AuthProvider>
    </TonConnectUIProvider>
  </StrictMode>
);
