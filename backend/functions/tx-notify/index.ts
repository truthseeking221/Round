import { getCorsHeaders, errorResponse, jsonResponse, readJson, withCors } from "../_shared/http.ts";
import { requireSession } from "../_shared/auth.ts";
import { enforceRateLimit } from "../_shared/rate-limit.ts";
import { createServiceClient } from "../_shared/supabase.ts";

type TxNotifyRequest = {
  tx_hash: string;
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

  const limited = await enforceRateLimit({
    supabase,
    origin,
    action: "tx_notify",
    key: `tg:${session.telegram_user_id}`,
    limit: 30,
    windowSeconds: 24 * 60 * 60,
  });
  if (limited) return limited;

  let body: TxNotifyRequest;
  try {
    body = await readJson<TxNotifyRequest>(req);
  } catch (e) {
    return errorResponse(e instanceof Error ? e.message : "INVALID_JSON", 400, undefined, origin);
  }
  if (!body?.tx_hash || !body?.circle_id) return errorResponse("BAD_REQUEST", 400, undefined, origin);

  const circleRes = await supabase.from("circles").select("contract_address").eq("circle_id", body.circle_id).single();
  if (circleRes.error || !circleRes.data) return errorResponse("CIRCLE_NOT_FOUND", 404, undefined, origin);
  if (!circleRes.data.contract_address) return errorResponse("CONTRACT_NOT_READY", 400, undefined, origin);

  // NOTE: This endpoint is optional (UX-only). Minimal implementation:
  // - record the tx hash for the indexer to pick up.
  // TODO: fetch tx details from provider and validate it targets the circle contract.
  const idempotencyKey = `${circleRes.data.contract_address}:tx:${body.tx_hash}`;

  const ins = await supabase.from("chain_events").insert({
    contract_address: circleRes.data.contract_address,
    tx_hash: body.tx_hash,
    lt: 0,
    event_type: "tx_notify",
    payload: { circle_id: body.circle_id },
    idempotency_key: idempotencyKey,
    processed: false,
  });

  if (ins.error) {
    // Idempotent: ignore duplicate notifications.
    if (ins.error.message.includes("duplicate key value")) {
      return jsonResponse({ ok: true, deduped: true }, 200, origin);
    }
    return errorResponse("DB_ERROR", 500, ins.error.message, origin);
  }

  return jsonResponse({ ok: true }, 200, origin);
});
