import { getCorsHeaders, errorResponse, jsonResponse, readJson, withCors } from "../_shared/http.ts";
import { enforceRateLimit, getClientIp } from "../_shared/rate-limit.ts";
import { createServiceClient } from "../_shared/supabase.ts";
import { verifyTelegramInitData } from "../_shared/telegram.ts";

type AuthTelegramRequest = {
  initData: string;
};

function base64Url(bytes: Uint8Array): string {
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  const base64 = btoa(str);
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return withCors(new Response(null, { status: 204, headers: getCorsHeaders(origin) }), origin);
  }
  if (req.method !== "POST") {
    return errorResponse("METHOD_NOT_ALLOWED", 405, undefined, origin);
  }

  const supabase = createServiceClient();

  // Basic IP-based throttling before initData verification (best-effort).
  const ip = getClientIp(req) ?? "unknown";
  const ipLimited = await enforceRateLimit({
    supabase,
    origin,
    action: "auth_telegram_ip",
    key: `ip:${ip}`,
    limit: 60,
    windowSeconds: 60,
  });
  if (ipLimited) return ipLimited;

  let body: AuthTelegramRequest;
  try {
    body = await readJson<AuthTelegramRequest>(req);
  } catch (e) {
    return errorResponse(e instanceof Error ? e.message : "INVALID_JSON", 400, undefined, origin);
  }
  if (!body?.initData || typeof body.initData !== "string") {
    return errorResponse("TG_INITDATA_INVALID", 400, undefined, origin);
  }

  const botToken = Deno.env.get("TELEGRAM_WEBAPP_SECRET") ?? Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (!botToken) {
    return errorResponse("SERVER_MISCONFIGURED", 500, undefined, origin);
  }

  let verified;
  try {
    verified = await verifyTelegramInitData({ initData: body.initData, botToken, maxAgeSeconds: 24 * 60 * 60 });
  } catch (e) {
    const code = e instanceof Error ? e.message : "TG_INITDATA_INVALID";
    if (code === "TG_INITDATA_EXPIRED") return errorResponse(code, 401, undefined, origin);
    return errorResponse("TG_INITDATA_INVALID", 400, undefined, origin);
  }

  const user = verified.user;
  // User-based throttling (matches PRD: 10 req/min/user).
  const userLimited = await enforceRateLimit({
    supabase,
    origin,
    action: "auth_telegram_user",
    key: `tg:${user.id}`,
    limit: 10,
    windowSeconds: 60,
  });
  if (userLimited) return userLimited;

  const upUser = await supabase
    .from("tg_users")
    .upsert(
      {
        telegram_user_id: user.id,
        username: user.username ?? null,
        first_name: user.first_name ?? null,
        last_name: user.last_name ?? null,
        photo_url: user.photo_url ?? null,
        language_code: user.language_code ?? null,
      },
      { onConflict: "telegram_user_id" }
    )
    .select()
    .single();
  if (upUser.error) {
    return errorResponse("DB_ERROR", 500, upUser.error.message, origin);
  }

  let groupChatId: number | null = null;
  let groupRow: unknown = null;
  if (verified.chat?.id) {
    groupChatId = verified.chat.id;
    const upGroup = await supabase
      .from("tg_groups")
      .upsert(
        {
          group_chat_id: groupChatId,
          title: verified.chat.title ?? null,
          type: verified.chat.type ?? null,
        },
        { onConflict: "group_chat_id" }
      )
      .select()
      .single();
    if (upGroup.error) {
      return errorResponse("DB_ERROR", 500, upGroup.error.message, origin);
    }
    groupRow = upGroup.data;
  }

  const tokenBytes = new Uint8Array(32);
  crypto.getRandomValues(tokenBytes);
  const sessionToken = base64Url(tokenBytes);

  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const insSession = await supabase.from("sessions").insert({
    session_token: sessionToken,
    telegram_user_id: user.id,
    group_chat_id: groupChatId,
    expires_at: expiresAt,
  });
  if (insSession.error) {
    return errorResponse("DB_ERROR", 500, insSession.error.message, origin);
  }

  return jsonResponse(
    {
      session_token: sessionToken,
      user: upUser.data,
      group: groupRow,
    },
    200,
    origin
  );
});
