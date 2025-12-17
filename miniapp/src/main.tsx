import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { TonConnectUIProvider } from "@tonconnect/ui-react";
import { Buffer } from "buffer";

import "./index.css";
import App from "./App.tsx";
import { AuthProvider } from "./auth/AuthProvider";
import { env } from "./lib/env";

// @ton/core relies on Buffer in the browser.
const g = globalThis as unknown as { Buffer?: typeof Buffer };
if (!g.Buffer) g.Buffer = Buffer;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TonConnectUIProvider
      manifestUrl={env.TONCONNECT_MANIFEST_URL}
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
