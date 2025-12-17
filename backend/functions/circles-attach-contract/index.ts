import { Address } from "npm:@ton/core@0.60.0";
import { keyPairFromSeed } from "npm:@ton/crypto@3.3.0";

import { errorResponse, jsonResponse, readJson, withCors } from "../_shared/http.ts";
import { requireSession } from "../_shared/auth.ts";
import { createServiceClient } from "../_shared/supabase.ts";
import { tonapiGetBlockchainAccount, tonapiRunGetMethod } from "../_shared/tonapi.ts";
import { readAddressFromStackRecord, readNumAt, unwrapTuple } from "../_shared/tvm.ts";

type AttachContractRequest = {
  circle_id: string;
  contract_address: string;
};

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) throw new Error("INVALID_HEX");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function bi(v: unknown): bigint {
  if (typeof v === "bigint") return v;
  if (typeof v === "number" && Number.isFinite(v)) return BigInt(Math.trunc(v));
  if (typeof v === "string" && v.length > 0) return BigInt(v);
  throw new Error("BAD_BIGINT");
}

const DEFAULT_CODE_HASH = "124bbcfa615474161cb7a7a421554b3acda363759827142356c0224918693d41";

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") {
    return withCors(new Response(null, { status: 204 }), origin);
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

  let body: AttachContractRequest;
  try {
    body = await readJson<AttachContractRequest>(req);
  } catch (e) {
    return errorResponse(e instanceof Error ? e.message : "INVALID_JSON", 400, undefined, origin);
  }
  if (!body?.circle_id || !body?.contract_address) return errorResponse("BAD_REQUEST", 400, undefined, origin);

  const circleRes = await supabase
    .from("circles")
    .select(
      "circle_id,group_chat_id,leader_user_id,status,contract_address,jetton_master,n_members,contribution_units,total_cycles,interval_sec,grace_sec,take_rate_bps,collateral_rate_bps,max_discount_bps,vesting_bps_cycle1,early_lock_rate_bps_cycle1,commit_duration_sec,reveal_duration_sec,max_pot_cap_units,min_deposit_units"
    )
    .eq("circle_id", body.circle_id)
    .single();
  if (circleRes.error || !circleRes.data) return errorResponse("CIRCLE_NOT_FOUND", 404, undefined, origin);

  if (session.group_chat_id && Number(session.group_chat_id) !== Number(circleRes.data.group_chat_id)) {
    return errorResponse("FORBIDDEN", 403, undefined, origin);
  }
  if (Number(session.telegram_user_id) !== Number(circleRes.data.leader_user_id)) {
    return errorResponse("FORBIDDEN", 403, "Only the circle leader can attach a contract", origin);
  }
  if (circleRes.data.status !== "Recruiting") {
    return errorResponse("CIRCLE_NOT_RECRUITING", 400, undefined, origin);
  }

  let contractAddr: Address;
  try {
    contractAddr = Address.parse(String(body.contract_address));
  } catch {
    return errorResponse("BAD_ADDRESS", 400, undefined, origin);
  }
  const normalized = contractAddr.toString();

  if (circleRes.data.contract_address) {
    const existing = String(circleRes.data.contract_address);
    if (existing === normalized) {
      return jsonResponse({ ok: true, contract_address: normalized, idempotent: true }, 200, origin);
    }
    return errorResponse("CONTRACT_ALREADY_ATTACHED", 400, undefined, origin);
  }

  // Verify code hash matches expected CircleContract code (prevents attaching malicious contract).
  const expectedCodeHash = (Deno.env.get("CIRCLE_CONTRACT_CODE_HASH") ?? DEFAULT_CODE_HASH).toLowerCase();
  const acc = await tonapiGetBlockchainAccount({ account: normalized });
  if (!acc) return errorResponse("CHAIN_LOOKUP_FAILED", 502, undefined, origin);

  const codeHash = String(acc.code_hash ?? "").toLowerCase();
  if (!codeHash) return errorResponse("CONTRACT_NOT_DEPLOYED", 400, "Account has no code_hash", origin);
  if (codeHash !== expectedCodeHash) {
    return errorResponse("CONTRACT_CODE_MISMATCH", 400, undefined, origin);
  }

  // Verify get_config matches DB snapshot (prevents attaching wrong parameters).
  const cfgExec = await tonapiRunGetMethod({ account: normalized, method: "get_config" });
  if (!cfgExec || !cfgExec.success) return errorResponse("GET_CONFIG_FAILED", 400, undefined, origin);
  const t = unwrapTuple(cfgExec.stack);
  if (t.length < 17) return errorResponse("GET_CONFIG_FAILED", 400, "Bad get_config stack", origin);

  const cfgJetton = readAddressFromStackRecord(t[0]);
  const cfgGuardian = readNumAt(t, 1);
  const cfgTreasury = readAddressFromStackRecord(t[2]);

  const cfgN = readNumAt(t, 3);
  const cfgC = readNumAt(t, 4);
  const cfgTotalCycles = readNumAt(t, 5);
  const cfgInterval = readNumAt(t, 6);
  const cfgGrace = readNumAt(t, 7);
  const cfgTake = readNumAt(t, 8);
  const cfgCollat = readNumAt(t, 9);
  const cfgMaxDisc = readNumAt(t, 10);
  const cfgVesting = readNumAt(t, 11);
  const cfgEarlyLock = readNumAt(t, 12);
  const cfgCommit = readNumAt(t, 13);
  const cfgReveal = readNumAt(t, 14);
  const cfgMaxPot = readNumAt(t, 15);
  const cfgMinDep = readNumAt(t, 16);

  // Guardian pubkey must match backend signer.
  const guardianSeedHex = Deno.env.get("GUARDIAN_PRIVATE_KEY");
  if (!guardianSeedHex) return errorResponse("SERVER_MISCONFIGURED", 500, "Missing GUARDIAN_PRIVATE_KEY", origin);
  let keypair;
  try {
    const seed = hexToBytes(guardianSeedHex);
    if (seed.length !== 32) return errorResponse("SERVER_MISCONFIGURED", 500, "GUARDIAN_PRIVATE_KEY must be 32-byte hex seed", origin);
    keypair = keyPairFromSeed(seed);
  } catch {
    return errorResponse("SERVER_MISCONFIGURED", 500, "Invalid GUARDIAN_PRIVATE_KEY", origin);
  }
  const expectedGuardian = BigInt(`0x${bytesToHex(keypair.publicKey)}`);
  if (cfgGuardian !== expectedGuardian) {
    return errorResponse("GUARDIAN_PUBKEY_MISMATCH", 400, undefined, origin);
  }

  const expectedJetton = String(circleRes.data.jetton_master ?? Deno.env.get("USDT_JETTON_MASTER") ?? "").trim();
  if (!expectedJetton) return errorResponse("SERVER_MISCONFIGURED", 500, "Missing USDT_JETTON_MASTER", origin);
  if (!cfgJetton.equals(Address.parse(expectedJetton))) {
    return errorResponse("JETTON_MASTER_MISMATCH", 400, undefined, origin);
  }

  // Treasury owner is not security-critical (can't withdraw user funds), but if configured, enforce.
  const expectedTreasury = String(Deno.env.get("TREASURY_OWNER") ?? "").trim();
  if (expectedTreasury) {
    if (!cfgTreasury.equals(Address.parse(expectedTreasury))) {
      return errorResponse("TREASURY_OWNER_MISMATCH", 400, undefined, origin);
    }
  }

  const checks: Array<[string, bigint, bigint]> = [
    ["n_members", cfgN, BigInt(circleRes.data.n_members)],
    ["contribution", cfgC, bi(circleRes.data.contribution_units)],
    ["total_cycles", cfgTotalCycles, BigInt(circleRes.data.total_cycles)],
    ["interval_sec", cfgInterval, BigInt(circleRes.data.interval_sec)],
    ["grace_sec", cfgGrace, BigInt(circleRes.data.grace_sec)],
    ["take_rate_bps", cfgTake, BigInt(circleRes.data.take_rate_bps)],
    ["collateral_rate_bps", cfgCollat, BigInt(circleRes.data.collateral_rate_bps)],
    ["max_discount_bps", cfgMaxDisc, BigInt(circleRes.data.max_discount_bps)],
    ["vesting_bps_cycle1", cfgVesting, BigInt(circleRes.data.vesting_bps_cycle1)],
    ["early_lock_rate_bps_cycle1", cfgEarlyLock, BigInt(circleRes.data.early_lock_rate_bps_cycle1)],
    ["commit_duration_sec", cfgCommit, BigInt(circleRes.data.commit_duration_sec)],
    ["reveal_duration_sec", cfgReveal, BigInt(circleRes.data.reveal_duration_sec)],
    ["max_pot_cap", cfgMaxPot, bi(circleRes.data.max_pot_cap_units)],
    ["min_deposit_units", cfgMinDep, bi(circleRes.data.min_deposit_units)]
  ];

  for (const [name, got, want] of checks) {
    if (got !== want) {
      return errorResponse("CONTRACT_CONFIG_MISMATCH", 400, `${name} mismatch`, origin);
    }
  }

  const upd = await supabase
    .from("circles")
    .update({ contract_address: normalized, jetton_master: expectedJetton })
    .eq("circle_id", body.circle_id)
    .select("circle_id,contract_address,jetton_master,status")
    .single();

  if (upd.error) return errorResponse("DB_ERROR", 500, upd.error.message, origin);
  return jsonResponse({ ok: true, circle: upd.data }, 200, origin);
});
