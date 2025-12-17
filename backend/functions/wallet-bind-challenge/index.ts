import { getCorsHeaders, errorResponse, jsonResponse, readJson, withCors } from "../_shared/http.ts";
import { requireSession } from "../_shared/auth.ts";
import { enforceRateLimit } from "../_shared/rate-limit.ts";
import { createServiceClient } from "../_shared/supabase.ts";

type BindChallengeRequest = {
  circle_id: string;
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

  let session;
  try {
    session = await requireSession({ req, supabase });
  } catch (e) {
    const code = e instanceof Error ? e.message : "AUTH_INVALID";
    return errorResponse(code, 401, undefined, origin);
  }

  const limited = await enforceRateLimit({
    supabase,
    origin,
    action: "wallet_bind_challenge",
    key: `tg:${session.telegram_user_id}`,
    limit: 5,
    windowSeconds: 24 * 60 * 60,
  });
  if (limited) return limited;

  let body: BindChallengeRequest;
  try {
    body = await readJson<BindChallengeRequest>(req);
  } catch (e) {
    return errorResponse(e instanceof Error ? e.message : "INVALID_JSON", 400, undefined, origin);
  }
  if (!body?.circle_id) return errorResponse("BAD_REQUEST", 400, "circle_id required", origin);

  const circleRes = await supabase.from("circles").select("circle_id,status").eq("circle_id", body.circle_id).single();
  if (circleRes.error || !circleRes.data) return errorResponse("CIRCLE_NOT_FOUND", 404, undefined, origin);
  if (circleRes.data.status !== "Recruiting") return errorResponse("CIRCLE_NOT_RECRUITING", 400, undefined, origin);

  const memberRes = await supabase
    .from("circle_members")
    .select("join_status,rules_signature_hash,wallet_address")
    .eq("circle_id", body.circle_id)
    .eq("telegram_user_id", session.telegram_user_id)
    .single();
  if (memberRes.error || !memberRes.data) return errorResponse("NOT_JOINED", 400, undefined, origin);
  if (memberRes.data.join_status === "exited") return errorResponse("NOT_JOINED", 400, undefined, origin);

  if (memberRes.data.join_status !== "accepted_rules") {
    // Once wallet is verified, we don't allow changing wallet in MVP.
    if (
      memberRes.data.join_status === "wallet_verified" ||
      memberRes.data.join_status === "ticket_issued" ||
      memberRes.data.join_status === "onchain_joined"
    ) {
      return errorResponse("WALLET_ALREADY_BOUND", 400, undefined, origin);
    }
    return errorResponse("RULES_NOT_ACCEPTED", 400, undefined, origin);
  }
  if (!memberRes.data.rules_signature_hash) return errorResponse("RULES_NOT_ACCEPTED", 400, undefined, origin);

  const nonceBytes = new Uint8Array(18);
  crypto.getRandomValues(nonceBytes);
  const nonce = base64Url(nonceBytes);

  const exp = Math.floor(Date.now() / 1000) + 10 * 60;
  const expIso = new Date(exp * 1000).toISOString();

  const messageToSign = `MC_BIND|${session.telegram_user_id}|${body.circle_id}|${nonce}|${exp}`;

  const ins = await supabase.from("wallet_bind_challenges").insert({
    telegram_user_id: session.telegram_user_id,
    circle_id: body.circle_id,
    nonce,
    exp: expIso,
    used: false,
  });
  if (ins.error) return errorResponse("DB_ERROR", 500, ins.error.message, origin);

  return jsonResponse({ nonce, exp, message_to_sign: messageToSign }, 200, origin);
});
