import { getCorsHeaders, errorResponse, jsonResponse, readJson, withCors } from "../_shared/http.ts";
import { requireSession } from "../_shared/auth.ts";
import { createServiceClient } from "../_shared/supabase.ts";
import { getChatMember, getTelegramBotToken } from "../_shared/telegram-api.ts";

type CirclesJoinRequest = {
  circle_id: string;
};

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return withCors(new Response(null, { status: 204, headers: getCorsHeaders(origin) }), origin);
  }
  if (req.method !== "POST") {
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

  let body: CirclesJoinRequest;
  try {
    body = await readJson<CirclesJoinRequest>(req);
  } catch (e) {
    return errorResponse(e instanceof Error ? e.message : "INVALID_JSON", 400, undefined, origin);
  }
  if (!body?.circle_id) {
    return errorResponse("BAD_REQUEST", 400, "circle_id required", origin);
  }

  const circleRes = await supabase
    .from("circles")
    .select("circle_id,status,group_chat_id")
    .eq("circle_id", body.circle_id)
    .single();
  if (circleRes.error || !circleRes.data) {
    return errorResponse("CIRCLE_NOT_FOUND", 404, undefined, origin);
  }
  if (circleRes.data.status !== "Recruiting") {
    return errorResponse("CIRCLE_NOT_RECRUITING", 400, undefined, origin);
  }

  // Social anchor: verify user is a group member.
  const botToken = getTelegramBotToken();
  const chatId = Number(circleRes.data.group_chat_id);
  const userId = Number(session.telegram_user_id);

  const memberRes = await getChatMember({ botToken, chatId, userId });
  if (!memberRes.ok) {
    return errorResponse("TG_NOT_IN_GROUP", 403, undefined, origin);
  }
  if (memberRes.result.status === "kicked") return errorResponse("TG_BANNED", 403, undefined, origin);
  if (memberRes.result.status === "left") return errorResponse("TG_NOT_IN_GROUP", 403, undefined, origin);

  const existing = await supabase
    .from("circle_members")
    .select("*")
    .eq("circle_id", body.circle_id)
    .eq("telegram_user_id", session.telegram_user_id)
    .maybeSingle();

  if (existing.error) return errorResponse("DB_ERROR", 500, existing.error.message, origin);
  if (existing.data) {
    if (existing.data.join_status === "exited") {
      const upd = await supabase
        .from("circle_members")
        .update({ join_status: "joined" })
        .eq("circle_id", body.circle_id)
        .eq("telegram_user_id", session.telegram_user_id)
        .select()
        .single();
      if (upd.error) return errorResponse("DB_ERROR", 500, upd.error.message, origin);
      return jsonResponse({ ok: true, member: upd.data }, 200, origin);
    }
    // Idempotent: never regress join_status.
    return jsonResponse({ ok: true, member: existing.data }, 200, origin);
  }

  const ins = await supabase
    .from("circle_members")
    .insert({
      circle_id: body.circle_id,
      telegram_user_id: session.telegram_user_id,
      join_status: "joined",
    })
    .select()
    .single();

  if (ins.error) return errorResponse("DB_ERROR", 500, ins.error.message, origin);
  return jsonResponse({ ok: true, member: ins.data }, 200, origin);
});
