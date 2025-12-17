import { getCorsHeaders, errorResponse, jsonResponse, readJson, withCors } from "../_shared/http.ts";
import { requireSession } from "../_shared/auth.ts";
import { createServiceClient } from "../_shared/supabase.ts";
import { getChatMember, getTelegramBotToken } from "../_shared/telegram-api.ts";

type AcceptRulesRequest = {
  circle_id: string;
  rules_signature_hash: string;
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

  let body: AcceptRulesRequest;
  try {
    body = await readJson<AcceptRulesRequest>(req);
  } catch (e) {
    return errorResponse(e instanceof Error ? e.message : "INVALID_JSON", 400, undefined, origin);
  }
  if (!body?.circle_id || !body?.rules_signature_hash) {
    return errorResponse("BAD_REQUEST", 400, undefined, origin);
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
  if (!memberRes.ok) return errorResponse("TG_NOT_IN_GROUP", 403, undefined, origin);
  if (memberRes.result.status === "kicked") return errorResponse("TG_BANNED", 403, undefined, origin);
  if (memberRes.result.status === "left") return errorResponse("TG_NOT_IN_GROUP", 403, undefined, origin);

  const existing = await supabase
    .from("circle_members")
    .select("*")
    .eq("circle_id", body.circle_id)
    .eq("telegram_user_id", session.telegram_user_id)
    .single();
  if (existing.error || !existing.data) {
    return errorResponse("NOT_JOINED", 400, undefined, origin);
  }
  if (existing.data.join_status === "exited") {
    return errorResponse("NOT_JOINED", 400, undefined, origin);
  }

  // Never regress state (e.g., wallet_verified -> accepted_rules).
  const js = existing.data.join_status as string;
  if (js === "joined" || js === "accepted_rules") {
    const upd = await supabase
      .from("circle_members")
      .update({ join_status: "accepted_rules", rules_signature_hash: body.rules_signature_hash })
      .eq("circle_id", body.circle_id)
      .eq("telegram_user_id", session.telegram_user_id)
      .select()
      .single();
    if (upd.error) return errorResponse("DB_ERROR", 500, upd.error.message, origin);
    return jsonResponse({ ok: true, member: upd.data }, 200, origin);
  }

  // Later stages: keep join_status, but allow idempotent rules_signature_hash update.
  const upd2 = await supabase
    .from("circle_members")
    .update({ rules_signature_hash: body.rules_signature_hash })
    .eq("circle_id", body.circle_id)
    .eq("telegram_user_id", session.telegram_user_id)
    .select()
    .single();
  if (upd2.error) return errorResponse("DB_ERROR", 500, upd2.error.message, origin);
  return jsonResponse({ ok: true, member: upd2.data }, 200, origin);
});
