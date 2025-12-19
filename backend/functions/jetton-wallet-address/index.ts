import { getCorsHeaders, errorResponse, jsonResponse, readJson, withCors } from "../_shared/http.ts";
import { requireSession } from "../_shared/auth.ts";
import { createServiceClient } from "../_shared/supabase.ts";
import { runGetMethodWithRetry } from "../_shared/tonapi.ts";
import { readAddressFromStackRecord, unwrapTuple } from "../_shared/tvm.ts";

type JettonWalletAddressRequest = {
  circle_id: string;
};

// Returns the user's Jetton wallet contract address for the circle's allowlisted jetton master (USDT).
// This is used by the Mini App to build a Jetton `transfer` message for deposits.
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

  let body: JettonWalletAddressRequest;
  try {
    body = await readJson<JettonWalletAddressRequest>(req);
  } catch (e) {
    return errorResponse(e instanceof Error ? e.message : "INVALID_JSON", 400, undefined, origin);
  }
  if (!body?.circle_id) return errorResponse("BAD_REQUEST", 400, "circle_id required", origin);

  const circleRes = await supabase
    .from("circles")
    .select("circle_id,group_chat_id,jetton_master")
    .eq("circle_id", body.circle_id)
    .single();
  if (circleRes.error || !circleRes.data) return errorResponse("CIRCLE_NOT_FOUND", 404, undefined, origin);

  if (!session.group_chat_id) {
    return errorResponse("TG_GROUP_REQUIRED", 400, "Open the mini app inside a Telegram group", origin);
  }
  if (Number(session.group_chat_id) !== Number(circleRes.data.group_chat_id)) {
    return errorResponse("FORBIDDEN", 403, undefined, origin);
  }

  if (!circleRes.data.jetton_master) return errorResponse("JETTON_NOT_CONFIGURED", 500, undefined, origin);

  const memberRes = await supabase
    .from("circle_members")
    .select("wallet_address,join_status")
    .eq("circle_id", body.circle_id)
    .eq("telegram_user_id", session.telegram_user_id)
    .maybeSingle();

  if (memberRes.error) return errorResponse("DB_ERROR", 500, memberRes.error.message, origin);
  if (!memberRes.data) return errorResponse("NOT_JOINED", 400, undefined, origin);
  if (memberRes.data.join_status === "exited") return errorResponse("NOT_JOINED", 400, undefined, origin);
  if (!memberRes.data.wallet_address) return errorResponse("WALLET_NOT_VERIFIED", 400, undefined, origin);

  const owner = String(memberRes.data.wallet_address);
  const master = String(circleRes.data.jetton_master);

  // Standard Jetton master getter.
  const exec = await runGetMethodWithRetry({ account: master, method: "get_wallet_address", args: [owner], maxRetries: 3 });
  if (!exec || !exec.success) return errorResponse("JETTON_GET_WALLET_FAILED", 502, undefined, origin);

  const tuple = unwrapTuple(exec.stack);
  if (tuple.length < 1) return errorResponse("JETTON_GET_WALLET_FAILED", 502, "empty stack", origin);

  let walletAddress: string;
  try {
    walletAddress = readAddressFromStackRecord(tuple[0]).toString();
  } catch {
    return errorResponse("JETTON_GET_WALLET_FAILED", 502, "bad address stack", origin);
  }

  return jsonResponse({ jetton_wallet_address: walletAddress, owner, jetton_master: master }, 200, origin);
});
