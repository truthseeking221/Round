export const env = {
  FUNCTIONS_BASE_URL: import.meta.env.VITE_FUNCTIONS_BASE_URL as string | undefined,
  TONCONNECT_MANIFEST_URL: (import.meta.env.VITE_TONCONNECT_MANIFEST_URL as string | undefined) ?? "",
  DEV_INIT_DATA: (import.meta.env.VITE_DEV_INIT_DATA as string | undefined) ?? ""
};

if (!env.TONCONNECT_MANIFEST_URL) {
  // The app still renders, but TonConnect will not work until set.
  console.warn("Missing VITE_TONCONNECT_MANIFEST_URL");
}
