import { getCorsHeaders, errorResponse, jsonResponse, withCors } from "../_shared/http.ts";
import { requireSession } from "../_shared/auth.ts";
import { createServiceClient } from "../_shared/supabase.ts";
import { getChatMember, getMe, getTelegramBotToken } from "../_shared/telegram-api.ts";

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return withCors(new Response(null, { status: 204, headers: getCorsHeaders(origin) }), origin);
  }
  if (req.method !== "GET") {
    return errorResponse("METHOD_NOT_ALLOWED", 405, undefined, origin);
  }

  const supabase = createServiceClient();

  let session;
  try {
    session = await requireSession({ req, supabase });
  } catch (e) {
    const code = e instanceof Error ? e.message : "AUTH_INVALID";
    return errorResponse(code, 401, undefined, origin);
  }

  const url = new URL(req.url);
  const circleId = url.searchParams.get("circle_id");
  if (!circleId) {
    return errorResponse("BAD_REQUEST", 400, "circle_id required", origin);
  }

  const circleRes = await supabase.from("circles").select("group_chat_id").eq("circle_id", circleId).single();
  if (circleRes.error || !circleRes.data) {
    return errorResponse("CIRCLE_NOT_FOUND", 404, undefined, origin);
  }

  const botToken = getTelegramBotToken();
  const chatId = Number(circleRes.data.group_chat_id);
  const userId = Number(session.telegram_user_id);

  // BOT_NOT_IN_GROUP: detect by querying bot membership first.
  const me = await getMe({ botToken });
  if (!me.ok) {
    return errorResponse("SERVER_MISCONFIGURED", 500, undefined, origin);
  }
  const botMember = await getChatMember({ botToken, chatId, userId: me.result.id });
  if (!botMember.ok || botMember.result.status === "left" || botMember.result.status === "kicked") {
    return errorResponse("BOT_NOT_IN_GROUP", 400, undefined, origin);
  }

  const memberRes = await getChatMember({ botToken, chatId, userId });
  if (!memberRes.ok) {
    return errorResponse("TG_NOT_IN_GROUP", 403, undefined, origin);
  }

  if (memberRes.result.status === "kicked") {
    return errorResponse("TG_BANNED", 403, undefined, origin);
  }
  if (memberRes.result.status === "left") {
    return errorResponse("TG_NOT_IN_GROUP", 403, undefined, origin);
  }

  // Best-effort: mark last_checked_at
  await supabase.from("tg_groups").update({ last_checked_at: new Date().toISOString() }).eq("group_chat_id", chatId);

  return jsonResponse({ verified: true, role: memberRes.result.status }, 200, origin);
});
