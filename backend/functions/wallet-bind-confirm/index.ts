import { Address } from "npm:@ton/core@0.60.0";
import { signVerify } from "npm:@ton/crypto@3.3.0";

import { getCorsHeaders, errorResponse, jsonResponse, readJson, withCors } from "../_shared/http.ts";
import { requireSession } from "../_shared/auth.ts";
import { enforceRateLimit } from "../_shared/rate-limit.ts";
import { createServiceClient } from "../_shared/supabase.ts";
import { getWalletPublicKey } from "../_shared/ton.ts";
import { decodeBase64 } from "../_shared/base64.ts";
import { verifySignDataText, type SignDataResponse } from "../_shared/sign-data.ts";
import { fetchAccountPublicKey } from "../_shared/tonapi.ts";

type BindConfirmRequest = {
  circle_id: string;
  wallet_address?: string;
  signature?: string; // legacy: base64 (or base64url) ed25519 signature over message_to_sign
  sign_data?: SignDataResponse; // preferred: TonConnect sign-data response
  nonce?: string;
  exp?: number;
};

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
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
    action: "wallet_bind_confirm",
    key: `tg:${session.telegram_user_id}`,
    limit: 5,
    windowSeconds: 24 * 60 * 60,
  });
  if (limited) return limited;

  let body: BindConfirmRequest;
  try {
    body = await readJson<BindConfirmRequest>(req);
  } catch (e) {
    return errorResponse(e instanceof Error ? e.message : "INVALID_JSON", 400, undefined, origin);
  }

  if (!body?.circle_id) return errorResponse("BAD_REQUEST", 400, undefined, origin);

  // Accept either:
  // - { circle_id, sign_data } (preferred)
  // - { circle_id, wallet_address, signature, nonce, exp } (legacy)
  let walletAddress = body.wallet_address ?? null;
  let nonce = body.nonce ?? null;
  let exp = body.exp ?? null;

  if (body.sign_data) {
    if (body.sign_data.payload?.type !== "text") return errorResponse("WALLET_PROOF_INVALID", 400, undefined, origin);
    const text = String(body.sign_data.payload.text ?? "");
    const parts = text.split("|");
    if (parts.length !== 5 || parts[0] !== "MC_BIND") return errorResponse("WALLET_PROOF_INVALID", 400, undefined, origin);
    if (parts[1] !== String(session.telegram_user_id)) return errorResponse("WALLET_PROOF_INVALID", 400, undefined, origin);
    if (parts[2] !== body.circle_id) return errorResponse("WALLET_PROOF_INVALID", 400, undefined, origin);
    nonce = parts[3];
    exp = Number(parts[4]);
    if (!nonce) return errorResponse("WALLET_PROOF_INVALID", 400, undefined, origin);
    if (!Number.isFinite(exp) || exp <= 0) return errorResponse("WALLET_PROOF_INVALID", 400, undefined, origin);
    if (body.wallet_address && body.wallet_address !== body.sign_data.address)
      return errorResponse("WALLET_PROOF_INVALID", 400, undefined, origin);
    walletAddress = body.sign_data.address;
  }

  if (!walletAddress || !nonce || !exp) return errorResponse("BAD_REQUEST", 400, undefined, origin);

  // Validate stored challenge (prevents replay / cross-session binding).
  const ch = await supabase
    .from("wallet_bind_challenges")
    .select("exp, used")
    .eq("telegram_user_id", session.telegram_user_id)
    .eq("circle_id", body.circle_id)
    .eq("nonce", nonce)
    .single();
  if (ch.error || !ch.data) return errorResponse("WALLET_BIND_EXPIRED", 400, undefined, origin);
  if (ch.data.used) return errorResponse("WALLET_BIND_EXPIRED", 400, undefined, origin);

  const expIso = String(ch.data.exp);
  const expSec = Math.floor(Date.parse(expIso) / 1000);
  if (!Number.isFinite(expSec) || expSec <= 0) return errorResponse("WALLET_BIND_EXPIRED", 400, undefined, origin);

  const nowSec = Math.floor(Date.now() / 1000);
  if (nowSec > expSec) return errorResponse("WALLET_BIND_EXPIRED", 400, undefined, origin);
  if (Number(exp) !== expSec) return errorResponse("WALLET_PROOF_INVALID", 400, undefined, origin);

  const messageToSign = `MC_BIND|${session.telegram_user_id}|${body.circle_id}|${nonce}|${expSec}`;

  // Verify TonConnect sign-data proof (preferred).
  if (body.sign_data) {
    const allowedDomainsEnv = Deno.env.get("TONCONNECT_ALLOWED_DOMAINS");
    if (!allowedDomainsEnv) return errorResponse("SERVER_MISCONFIGURED", 500, undefined, origin);
    const allowedDomains = allowedDomainsEnv
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    const domain = String(body.sign_data.domain ?? "").toLowerCase();
    if (!allowedDomains.includes(domain)) return errorResponse("WALLET_PROOF_INVALID", 400, undefined, origin);

    const maxAge = Number(Deno.env.get("TONCONNECT_MAX_AGE_SECONDS") ?? "900");
    const ts = Number(body.sign_data.timestamp);
    if (!Number.isFinite(ts) || ts <= 0) return errorResponse("WALLET_PROOF_INVALID", 400, undefined, origin);
    // Basic freshness guard (prevents replay).
    if (Math.abs(nowSec - ts) > maxAge) return errorResponse("WALLET_PROOF_INVALID", 400, undefined, origin);

    let addrOk = false;
    try {
      const a1 = Address.parse(walletAddress);
      const a2 = Address.parse(body.sign_data.address);
      addrOk = a1.equals(a2);
    } catch {
      addrOk = false;
    }
    if (!addrOk) return errorResponse("WALLET_PROOF_INVALID", 400, undefined, origin);

    if (body.sign_data.payload?.type !== "text" || body.sign_data.payload.text !== messageToSign) {
      return errorResponse("WALLET_PROOF_INVALID", 400, undefined, origin);
    }

    let pkHex = (await fetchAccountPublicKey({ account: walletAddress })) ?? null;
    if (!pkHex) {
      // Fallback to Toncenter get_public_key (provider redundancy).
      try {
        pkHex = bytesToHex(await getWalletPublicKey({ walletAddress }));
      } catch {
        pkHex = null;
      }
    }
    if (!pkHex) return errorResponse("WALLET_PROOF_INVALID", 400, undefined, origin);

    const ok = await verifySignDataText({ result: body.sign_data, publicKeyHex: pkHex });
    if (!ok) return errorResponse("WALLET_PROOF_INVALID", 400, undefined, origin);
  } else {
    // Legacy fallback: signature is a detached ed25519 over messageToSign.
    if (!body.signature) return errorResponse("WALLET_PROOF_INVALID", 400, undefined, origin);

    let sigBytes: Uint8Array;
    try {
      sigBytes = decodeBase64(body.signature);
    } catch {
      return errorResponse("WALLET_PROOF_INVALID", 400, undefined, origin);
    }

    let pubkey: Uint8Array;
    try {
      pubkey = await getWalletPublicKey({ walletAddress });
    } catch {
      return errorResponse("WALLET_PROOF_INVALID", 400, undefined, origin);
    }

    const ok = signVerify(new TextEncoder().encode(messageToSign), sigBytes, pubkey);
    if (!ok) return errorResponse("WALLET_PROOF_INVALID", 400, undefined, origin);
  }

  // Enforce wallet binding uniqueness.
  const existingWallet = await supabase
    .from("wallet_bindings")
    .select("telegram_user_id")
    .eq("wallet_address", walletAddress)
    .maybeSingle();
  if (existingWallet.error) return errorResponse("DB_ERROR", 500, existingWallet.error.message, origin);
  if (existingWallet.data && Number(existingWallet.data.telegram_user_id) !== Number(session.telegram_user_id)) {
    return errorResponse("WALLET_ALREADY_BOUND", 400, undefined, origin);
  }

  const existingUser = await supabase
    .from("wallet_bindings")
    .select("wallet_address")
    .eq("telegram_user_id", session.telegram_user_id)
    .maybeSingle();
  if (existingUser.error) return errorResponse("DB_ERROR", 500, existingUser.error.message, origin);
  if (existingUser.data && existingUser.data.wallet_address !== walletAddress) {
    return errorResponse("WALLET_ALREADY_BOUND", 400, undefined, origin);
  }

  // Ensure join status allows wallet verification.
  const cm = await supabase
    .from("circle_members")
    .select("join_status,wallet_address,rules_signature_hash")
    .eq("circle_id", body.circle_id)
    .eq("telegram_user_id", session.telegram_user_id)
    .single();
  if (cm.error || !cm.data) return errorResponse("NOT_JOINED", 400, undefined, origin);
  if (!cm.data.rules_signature_hash) return errorResponse("RULES_NOT_ACCEPTED", 400, undefined, origin);
  if (cm.data.join_status !== "accepted_rules" && cm.data.join_status !== "wallet_verified") {
    return errorResponse("RULES_NOT_ACCEPTED", 400, undefined, origin);
  }

  if (cm.data.wallet_address && cm.data.wallet_address !== walletAddress) {
    return errorResponse("WALLET_ALREADY_BOUND", 400, undefined, origin);
  }

  const upWallet = await supabase
    .from("wallet_bindings")
    .upsert({ telegram_user_id: session.telegram_user_id, wallet_address: walletAddress }, { onConflict: "telegram_user_id" });
  if (upWallet.error) return errorResponse("DB_ERROR", 500, upWallet.error.message, origin);

  const updMember = await supabase
    .from("circle_members")
    .update({ wallet_address: walletAddress, join_status: "wallet_verified" })
    .eq("circle_id", body.circle_id)
    .eq("telegram_user_id", session.telegram_user_id)
    .select()
    .single();
  if (updMember.error) return errorResponse("DB_ERROR", 500, updMember.error.message, origin);

  // Mark challenge used (idempotent guard).
  const updCh = await supabase
    .from("wallet_bind_challenges")
    .update({ used: true })
    .eq("telegram_user_id", session.telegram_user_id)
    .eq("circle_id", body.circle_id)
    .eq("nonce", nonce)
    .eq("used", false);
  if (updCh.error) return errorResponse("DB_ERROR", 500, updCh.error.message, origin);

  return jsonResponse({ ok: true, wallet_address: walletAddress, member: updMember.data }, 200, origin);
});
