/**
 * MoneyCircle — verify CircleContract deployment/config (v1.2.1)
 *
 * Usage:
 *   npx tsx scripts/verify.ts --network testnet EQ...contract
 *
 * Optional env (used for comparisons):
 *   USDT_JETTON_MASTER, GUARDIAN_PUBLIC_KEY (or GUARDIAN_PRIVATE_KEY), TREASURY_OWNER
 *   CIRCLE_CONTRACT_CODE_HASH (expected code hash, hex)
 */

import { Address, Cell } from "@ton/core";
import { keyPairFromSeed } from "@ton/crypto";
import { TonClient } from "@ton/ton";

import { CircleContract } from "../build/CircleContract_CircleContract.ts";

function argValue(name: string): string | null {
  const i = process.argv.indexOf(name);
  if (i < 0) return null;
  return process.argv[i + 1] ?? null;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function parseHexBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (!/^[0-9a-fA-F]+$/.test(clean) || clean.length % 2 !== 0) throw new Error("Invalid hex");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function getGuardianPubkeyOrNull(): bigint | null {
  const pub = process.env.GUARDIAN_PUBLIC_KEY;
  if (pub) {
    const bytes = parseHexBytes(pub);
    if (bytes.length !== 32) throw new Error("GUARDIAN_PUBLIC_KEY must be 32-byte hex");
    return BigInt(`0x${Buffer.from(bytes).toString("hex")}`);
  }
  const seed = process.env.GUARDIAN_PRIVATE_KEY;
  if (!seed) return null;
  const bytes = parseHexBytes(seed);
  if (bytes.length !== 32) throw new Error("GUARDIAN_PRIVATE_KEY must be 32-byte hex seed");
  const kp = keyPairFromSeed(Buffer.from(bytes));
  return BigInt(`0x${kp.publicKey.toString("hex")}`);
}

function endpointForNetwork(network: "testnet" | "mainnet"): string {
  const fromEnv = process.env.TONCENTER_ENDPOINT;
  if (fromEnv) return fromEnv;
  return network === "testnet" ? "https://testnet.toncenter.com/api/v2/jsonRPC" : "https://toncenter.com/api/v2/jsonRPC";
}

function fmtAddr(a: Address | null | undefined): string {
  if (!a) return "(null)";
  return a.toString();
}

async function main() {
  const network = (argValue("--network") ?? (hasFlag("--mainnet") ? "mainnet" : "testnet")) as "testnet" | "mainnet";
  if (network !== "testnet" && network !== "mainnet") throw new Error("Invalid --network (testnet|mainnet)");

  const contractAddress = process.argv.find((a) => a.startsWith("EQ") || a.startsWith("kQ") || a.includes(":"));
  if (!contractAddress) {
    console.error("Usage: npx tsx scripts/verify.ts --network testnet <contract_address>");
    process.exit(1);
  }

  const endpoint = endpointForNetwork(network);
  const apiKey = process.env.TONCENTER_KEY;
  const client = new TonClient({ endpoint, apiKey });

  const addr = Address.parse(contractAddress);
  const deployed = await client.isContractDeployed(addr);
  console.log(`[contract] ${addr.toString()} deployed=${deployed}`);

  const state = await client.getContractState(addr);
  console.log(`[state] ${state.state} balance=${state.balance} nanoTON`);

  let codeHash: string | null = null;
  if (state.code) {
    const codeCell = Cell.fromBoc(state.code)[0];
    codeHash = codeCell.hash().toString("hex");
    console.log(`[code_hash] ${codeHash}`);
  }

  const expectedCodeHash = process.env.CIRCLE_CONTRACT_CODE_HASH?.toLowerCase() ?? null;
  if (expectedCodeHash && codeHash) {
    console.log(`[code_hash_check] expected=${expectedCodeHash} ok=${codeHash.toLowerCase() === expectedCodeHash}`);
  }

  const c = client.open(CircleContract.fromAddress(addr));
  const cfg = await c.getGetConfig();
  const st = await c.getGetStatus();
  const jettonWallet = await c.getGetJettonWallet();

  console.log("\n[get_config]");
  console.log(`jetton_master: ${fmtAddr(cfg.jetton_master)}`);
  console.log(`guardian_pubkey: 0x${cfg.guardian_pubkey.toString(16)}`);
  console.log(`treasury_owner: ${fmtAddr(cfg.treasury_owner)}`);
  console.log(`n_members: ${cfg.n_members}`);
  console.log(`contribution: ${cfg.contribution} (units)`);
  console.log(`total_cycles: ${cfg.total_cycles}`);
  console.log(`interval_sec: ${cfg.interval_sec}`);
  console.log(`grace_sec: ${cfg.grace_sec}`);
  console.log(`take_rate_bps: ${cfg.take_rate_bps}`);
  console.log(`collateral_rate_bps: ${cfg.collateral_rate_bps}`);
  console.log(`max_discount_bps: ${cfg.max_discount_bps}`);
  console.log(`vesting_bps_cycle1: ${cfg.vesting_bps_cycle1}`);
  console.log(`early_lock_rate_bps_cycle1: ${cfg.early_lock_rate_bps_cycle1}`);
  console.log(`commit_duration_sec: ${cfg.commit_duration_sec}`);
  console.log(`reveal_duration_sec: ${cfg.reveal_duration_sec}`);
  console.log(`max_pot_cap: ${cfg.max_pot_cap}`);
  console.log(`min_deposit_units: ${cfg.min_deposit_units}`);

  console.log("\n[get_status]");
  console.log(`status: ${st.status}`);
  console.log(`current_cycle: ${st.current_cycle}`);
  console.log(`phase: ${st.phase}`);
  console.log(`due_at: ${st.due_at}`);
  console.log(`grace_end_at: ${st.grace_end_at}`);
  console.log(`commit_end_at: ${st.commit_end_at}`);
  console.log(`reveal_end_at: ${st.reveal_end_at}`);
  console.log(`funded_count: ${st.funded_count}`);
  console.log(`jetton_wallet: ${fmtAddr(jettonWallet)}`);

  const expectedJetton = process.env.USDT_JETTON_MASTER ? Address.parse(process.env.USDT_JETTON_MASTER) : null;
  if (expectedJetton) {
    console.log(`[check] jetton_master ok=${cfg.jetton_master.equals(expectedJetton)}`);
  }

  const expectedGuardian = getGuardianPubkeyOrNull();
  if (expectedGuardian) {
    console.log(`[check] guardian_pubkey ok=${cfg.guardian_pubkey === expectedGuardian}`);
  }

  const expectedTreasury = process.env.TREASURY_OWNER ? Address.parse(process.env.TREASURY_OWNER) : null;
  if (expectedTreasury) {
    console.log(`[check] treasury_owner ok=${cfg.treasury_owner.equals(expectedTreasury)}`);
  }
}

main().catch((err) => {
  console.error("Verification failed:", err?.message ?? err);
  process.exit(1);
});





