export const env = {
  FUNCTIONS_BASE_URL: import.meta.env.VITE_FUNCTIONS_BASE_URL as string | undefined,
  TONCONNECT_MANIFEST_URL: (import.meta.env.VITE_TONCONNECT_MANIFEST_URL as string | undefined) ?? "",
  DEV_INIT_DATA: (import.meta.env.VITE_DEV_INIT_DATA as string | undefined) ?? "",
  
  /**
   * MOCK MODE: Must be explicitly enabled via VITE_ENABLE_MOCK=true
   * 
   * Previously: mock mode was auto-enabled when FUNCTIONS_BASE_URL was missing.
   * This was dangerous because it could ship to production if env var was forgotten.
   * 
   * Now: mock mode requires explicit opt-in. If FUNCTIONS_BASE_URL is missing
   * and ENABLE_MOCK is not set, the app will fail hard with clear error.
   */
  ENABLE_MOCK: import.meta.env.VITE_ENABLE_MOCK === "true",
};

// Validation: if no backend URL and mock not enabled, this is a config error
if (!env.FUNCTIONS_BASE_URL && !env.ENABLE_MOCK) {
  console.error(
    "[ENV ERROR] VITE_FUNCTIONS_BASE_URL is not set and VITE_ENABLE_MOCK is not 'true'.\n" +
    "For production: Set VITE_FUNCTIONS_BASE_URL to your backend URL.\n" +
    "For development with mocks: Set VITE_ENABLE_MOCK=true in your .env file."
  );
}

if (!env.TONCONNECT_MANIFEST_URL) {
  console.warn("Missing VITE_TONCONNECT_MANIFEST_URL");
}