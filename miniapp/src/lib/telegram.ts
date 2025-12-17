import WebApp from "@twa-dev/sdk";

export function getTelegramInitData(): string | null {
  const initData = WebApp?.initData;
  if (typeof initData === "string" && initData.length > 0) return initData;
  return null;
}

export function initTelegramUi() {
  try {
    WebApp.ready();
    WebApp.expand();
  } catch {
    // ignore if not running inside Telegram
  }
}

