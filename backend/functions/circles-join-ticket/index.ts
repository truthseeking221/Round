import { Address, beginCell } from "npm:@ton/core@0.60.0";
import { keyPairFromSeed, sign } from "npm:@ton/crypto@3.3.0";

import { getCorsHeaders, errorResponse, jsonResponse, readJson, withCors } from "../_shared/http.ts";
import { requireSession } from "../_shared/auth.ts";
import { enforceRateLimit } from "../_shared/rate-limit.ts";
import { createServiceClient } from "../_shared/supabase.ts";
import { getChatMember, getTelegramBotToken } from "../_shared/telegram-api.ts";

type JoinTicketRequest = {
  circle_id: string;
  wallet_address?: string;
};

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) throw new Error("INVALID_HEX");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function base64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function randomU64(): bigint {
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  let n = 0n;
  for (const v of b) n = (n << 8n) | BigInt(v);
  return n;
}

function buildJoinHash(contract: Address, wallet: Address, exp: number, nonce: bigint): Uint8Array {
  return beginCell()
    .storeUint(0x4d43, 16) // "MC"
    .storeUint(0x5f4a4f494e, 40) // "_JOIN"
    .storeAddress(contract)
    .storeAddress(wallet)
    .storeUint(exp, 32)
    .storeUint(nonce, 64)
    .endCell()
    .hash();
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
    action: "join_ticket_issue",
    key: `tg:${session.telegram_user_id}`,
    limit: 10,
    windowSeconds: 24 * 60 * 60,
  });
  if (limited) return limited;

  let body: JoinTicketRequest;
  try {
    body = await readJson<JoinTicketRequest>(req);
  } catch (e) {
    return errorResponse(e instanceof Error ? e.message : "INVALID_JSON", 400, undefined, origin);
  }
  if (!body?.circle_id) {
    return errorResponse("BAD_REQUEST", 400, "circle_id required", origin);
  }

  const circleRes = await supabase
    .from("circles")
    .select("circle_id, status, contract_address, group_chat_id")
    .eq("circle_id", body.circle_id)
    .single();
  if (circleRes.error || !circleRes.data) {
    return errorResponse("CIRCLE_NOT_FOUND", 404, undefined, origin);
  }
  if (circleRes.data.status !== "Recruiting") {
    return errorResponse("CIRCLE_NOT_RECRUITING", 400, undefined, origin);
  }
  if (!circleRes.data.contract_address) {
    return errorResponse("CONTRACT_NOT_READY", 400, undefined, origin);
  }

  // Social anchor: user must still be in the group when requesting a join ticket.
  let botToken: string;
  try {
    botToken = getTelegramBotToken();
  } catch {
    return errorResponse("SERVER_MISCONFIGURED", 500, undefined, origin);
  }
  const chatId = Number(circleRes.data.group_chat_id);
  const userId = Number(session.telegram_user_id);
  const memberCheck = await getChatMember({ botToken, chatId, userId });
  if (!memberCheck.ok) return errorResponse("NOT_VERIFIED_IN_GROUP", 403, undefined, origin);
  if (memberCheck.result.status === "kicked") return errorResponse("TG_BANNED", 403, undefined, origin);
  if (memberCheck.result.status === "left") return errorResponse("TG_NOT_IN_GROUP", 403, undefined, origin);

  const memberRes = await supabase
    .from("circle_members")
    .select("wallet_address, join_status, rules_signature_hash")
    .eq("circle_id", body.circle_id)
    .eq("telegram_user_id", session.telegram_user_id)
    .single();
  if (memberRes.error || !memberRes.data) {
    return errorResponse("NOT_JOINED", 400, undefined, origin);
  }
  if (!memberRes.data.rules_signature_hash) {
    return errorResponse("RULES_NOT_ACCEPTED", 400, undefined, origin);
  }
  if (memberRes.data.join_status !== "wallet_verified" && memberRes.data.join_status !== "ticket_issued") {
    // join_status ladder: joined -> accepted_rules -> wallet_verified -> ticket_issued -> onchain_joined
    if (memberRes.data.join_status === "joined" || memberRes.data.join_status === "exited") {
      return errorResponse("RULES_NOT_ACCEPTED", 400, undefined, origin);
    }
    return errorResponse("WALLET_NOT_VERIFIED", 400, undefined, origin);
  }
  if (!memberRes.data.wallet_address) {
    return errorResponse("WALLET_NOT_VERIFIED", 400, undefined, origin);
  }
  if (body.wallet_address && body.wallet_address !== memberRes.data.wallet_address) {
    return errorResponse("WALLET_NOT_VERIFIED", 400, "wallet mismatch", origin);
  }

  let contractAddr: Address;
  let walletAddr: Address;
  try {
    contractAddr = Address.parse(circleRes.data.contract_address);
    walletAddr = Address.parse(memberRes.data.wallet_address);
  } catch {
    return errorResponse("BAD_ADDRESS", 400, undefined, origin);
  }

  const guardianSeedHex = Deno.env.get("GUARDIAN_PRIVATE_KEY");
  if (!guardianSeedHex) {
    return errorResponse("SERVER_MISCONFIGURED", 500, undefined, origin);
  }
  let keypair;
  try {
    const seed = hexToBytes(guardianSeedHex);
    if (seed.length !== 32) return errorResponse("SERVER_MISCONFIGURED", 500, undefined, origin);
    keypair = keyPairFromSeed(seed);
  } catch {
    return errorResponse("SERVER_MISCONFIGURED", 500, undefined, origin);
  }

  const exp = Math.floor(Date.now() / 1000) + 10 * 60;
  const nonce = randomU64();
  const h = buildJoinHash(contractAddr, walletAddr, exp, nonce);
  const sig = sign(h, keypair.secretKey);

  const expIso = new Date(exp * 1000).toISOString();
  const nonceStr = nonce.toString();
  const sigB64 = base64(sig);

  const ins = await supabase.from("join_tickets").insert({
    circle_id: body.circle_id,
    telegram_user_id: session.telegram_user_id,
    wallet_address: memberRes.data.wallet_address,
    exp: expIso,
    nonce: nonceStr,
    sig: sigB64,
    used: false,
  });
  if (ins.error) {
    return errorResponse("DB_ERROR", 500, ins.error.message, origin);
  }

  const upd = await supabase
    .from("circle_members")
    .update({ join_status: "ticket_issued" })
    .eq("circle_id", body.circle_id)
    .eq("telegram_user_id", session.telegram_user_id);
  if (upd.error) {
    return errorResponse("DB_ERROR", 500, upd.error.message, origin);
  }

  return jsonResponse(
    {
      wallet: memberRes.data.wallet_address,
      exp,
      nonce: nonceStr,
      sig: sigB64,
      contract_address: circleRes.data.contract_address,
    },
    200,
    origin
  );
});
