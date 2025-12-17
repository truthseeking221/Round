export type TelegramUser = {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  photo_url?: string;
};

export type TelegramChat = {
  id: number;
  type?: string;
  title?: string;
  username?: string;
};

export type VerifiedInitData = {
  raw: string;
  authDate: number;
  user: TelegramUser;
  chat?: TelegramChat;
};

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error("INVALID_HEX");
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hmacSha256(key: ArrayBuffer, message: ArrayBuffer): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return await crypto.subtle.sign("HMAC", cryptoKey, message);
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a[i] ^ b[i];
  return out === 0;
}

export async function verifyTelegramInitData(params: {
  initData: string;
  botToken: string;
  maxAgeSeconds: number;
}): Promise<VerifiedInitData> {
  const initData = params.initData.startsWith("?") ? params.initData.slice(1) : params.initData;
  const sp = new URLSearchParams(initData);

  const hash = sp.get("hash");
  const authDateStr = sp.get("auth_date");
  const userStr = sp.get("user");

  if (!hash || !authDateStr || !userStr) {
    throw new Error("TG_INITDATA_INVALID");
  }

  const authDate = Number(authDateStr);
  if (!Number.isFinite(authDate) || authDate <= 0) {
    throw new Error("TG_INITDATA_INVALID");
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (nowSec - authDate > params.maxAgeSeconds) {
    throw new Error("TG_INITDATA_EXPIRED");
  }

  const entries: [string, string][] = [];
  for (const [k, v] of sp.entries()) {
    if (k === "hash") continue;
    entries.push([k, v]);
  }
  entries.sort(([a], [b]) => a.localeCompare(b));
  const dataCheckString = entries.map(([k, v]) => `${k}=${v}`).join("\n");

  // Telegram WebApp auth:
  // secret_key = HMAC_SHA256(key="WebAppData", msg=bot_token)
  // data_hash  = HMAC_SHA256(key=secret_key, msg=data_check_string)
  const secretKey = await hmacSha256(
    new TextEncoder().encode("WebAppData").buffer,
    new TextEncoder().encode(params.botToken).buffer
  );
  const computed = await hmacSha256(secretKey, new TextEncoder().encode(dataCheckString).buffer);

  const expected = bytesToHex(computed);
  const ok = timingSafeEqual(hexToBytes(expected), hexToBytes(hash));
  if (!ok) {
    throw new Error("TG_INITDATA_INVALID");
  }

  let user: TelegramUser;
  try {
    user = JSON.parse(userStr) as TelegramUser;
  } catch {
    throw new Error("TG_INITDATA_INVALID");
  }
  if (!user?.id) throw new Error("TG_INITDATA_INVALID");

  const chatStr = sp.get("chat");
  let chat: TelegramChat | undefined;
  if (chatStr) {
    try {
      chat = JSON.parse(chatStr) as TelegramChat;
    } catch {
      chat = undefined;
    }
  }

  return { raw: params.initData, authDate, user, chat };
}

