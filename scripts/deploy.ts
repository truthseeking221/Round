/**
 * MoneyCircle — deploy CircleContract (v1.2.1)
 *
 * Usage (recommended via tsx):
 *   npx tsx scripts/deploy.ts --network testnet --n 10 --contribution-usdt 10 --interval weekly
 *
 * Required env:
 *   DEPLOY_WALLET_MNEMONIC="word1 ... word24"
 *   USDT_JETTON_MASTER="EQ..."
 *   GUARDIAN_PUBLIC_KEY="hex32bytes"  (or GUARDIAN_PRIVATE_KEY="hex32bytes" to derive pubkey)
 *
 * Optional env (defaults match backend v1.2.1):
 *   TREASURY_OWNER="EQ..." (or TREASURY_ADDRESS)
 *   TONCENTER_ENDPOINT="https://testnet.toncenter.com/api/v2/jsonRPC"
 *   TONCENTER_KEY="..."
 *   COLLATERAL_RATE_BPS="1000"
 *   MAX_POT_CAP_UNITS="500000000"
 *   MIN_DEPOSIT_UNITS="100000"
 *   DEPLOY_VALUE_TON="0.25"
 */

import { Address, beginCell, internal, toNano } from "@ton/core";
import { keyPairFromSeed, mnemonicToWalletKey } from "@ton/crypto";
import { TonClient, WalletContractV4 } from "@ton/ton";

import { CircleContract, type Config } from "../build/CircleContract_CircleContract.ts";

function argValue(name: string): string | null {
  const i = process.argv.indexOf(name);
  if (i < 0) return null;
  return process.argv[i + 1] ?? null;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

function envOr(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

function parseHexBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (!/^[0-9a-fA-F]+$/.test(clean) || clean.length % 2 !== 0) throw new Error("Invalid hex");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function parseUsdtToUnits(input: string): bigint {
  const s = String(input).trim();
  if (!/^\d+(?:\.\d+)?$/.test(s)) throw new Error("Invalid USDT amount");
  const [whole, fracRaw = ""] = s.split(".");
  if (fracRaw.length > 6) throw new Error("Too many decimals (max 6)");
  const frac = fracRaw.padEnd(6, "0");
  return BigInt(whole) * 1_000_000n + BigInt(frac);
}

function getGuardianPubkey(): bigint {
  const pub = process.env.GUARDIAN_PUBLIC_KEY;
  if (pub) {
    const bytes = parseHexBytes(pub);
    if (bytes.length !== 32) throw new Error("GUARDIAN_PUBLIC_KEY must be 32-byte hex");
    return BigInt(`0x${Buffer.from(bytes).toString("hex")}`);
  }
  const seed = process.env.GUARDIAN_PRIVATE_KEY;
  if (!seed) throw new Error("Missing GUARDIAN_PUBLIC_KEY or GUARDIAN_PRIVATE_KEY");
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

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const network = (argValue("--network") ?? (hasFlag("--mainnet") ? "mainnet" : "testnet")) as "testnet" | "mainnet";
  if (network !== "testnet" && network !== "mainnet") throw new Error("Invalid --network (testnet|mainnet)");

  const nMembers = Number(argValue("--n") ?? argValue("--n-members") ?? "");
  if (!Number.isFinite(nMembers) || nMembers < 2 || nMembers > 12) throw new Error("--n must be 2..12");

  const contributionUsdt = argValue("--contribution-usdt");
  if (!contributionUsdt) throw new Error("Missing --contribution-usdt");
  const contributionUnits = parseUsdtToUnits(contributionUsdt);

  const interval = (argValue("--interval") ?? "weekly") as "weekly" | "monthly";
  const intervalSec = interval === "monthly" ? 30n * 24n * 3600n : 7n * 24n * 3600n;

  const jettonMaster = Address.parse(requireEnv("USDT_JETTON_MASTER"));
  const guardianPubkey = getGuardianPubkey();

  const treasuryOwnerEnv = process.env.TREASURY_OWNER ?? process.env.TREASURY_ADDRESS;
  if (!treasuryOwnerEnv) throw new Error("Missing env TREASURY_OWNER (or TREASURY_ADDRESS)");
  const treasuryOwner = Address.parse(treasuryOwnerEnv);

  const collateralRateBps = BigInt(envOr("COLLATERAL_RATE_BPS", "1000"));
  const maxPotCapUnits = BigInt(envOr("MAX_POT_CAP_UNITS", "500000000"));
  const minDepositUnits = BigInt(envOr("MIN_DEPOSIT_UNITS", "100000"));

  const config: Config = {
    $$type: "Config",
    jetton_master: jettonMaster,
    guardian_pubkey: guardianPubkey,
    treasury_owner: treasuryOwner,

    n_members: BigInt(nMembers),
    contribution: contributionUnits,
    total_cycles: BigInt(nMembers),

    interval_sec: intervalSec,
    grace_sec: 24n * 3600n,

    take_rate_bps: 100n,
    collateral_rate_bps: collateralRateBps,
    max_discount_bps: 500n,

    vesting_bps_cycle1: 2000n,
    early_lock_rate_bps_cycle1: 3000n,

    commit_duration_sec: 1800n,
    reveal_duration_sec: 1800n,

    max_pot_cap: maxPotCapUnits,
    min_deposit_units: minDepositUnits,
  };

  const endpoint = endpointForNetwork(network);
  const apiKey = process.env.TONCENTER_KEY;
  const client = new TonClient({ endpoint, apiKey });

  const mnemonic = requireEnv("DEPLOY_WALLET_MNEMONIC").trim().split(/\s+/);
  const walletKey = await mnemonicToWalletKey(mnemonic);
  const wallet = WalletContractV4.create({ workchain: 0, publicKey: walletKey.publicKey });
  const walletContract = client.open(wallet);

  const walletDeployed = await client.isContractDeployed(wallet.address);
  if (!walletDeployed) {
    throw new Error(`Deployer wallet is not deployed: ${wallet.address.toString()}`);
  }

  const balance = await walletContract.getBalance();
  console.log(`[wallet] ${wallet.address.toString()} balance=${balance} nanoTON`);

  const contract = await CircleContract.fromInit(config);
  console.log(`[contract] address=${contract.address.toString()}`);

  const already = await client.isContractDeployed(contract.address);
  if (already) {
    console.log("Already deployed.");
    return;
  }

  const deployValue = envOr("DEPLOY_VALUE_TON", "0.25");
  const seqno = await walletContract.getSeqno();
  console.log(`[wallet] seqno=${seqno} deploying…`);

  await walletContract.sendTransfer({
    seqno,
    secretKey: walletKey.secretKey,
    messages: [
      internal({
        to: contract.address,
        value: toNano(deployValue),
        init: contract.init,
        body: beginCell().endCell(),
      }),
    ],
  });

  // Wait until deployed (best-effort).
  for (let i = 0; i < 30; i++) {
    await sleep(2000);
    const ok = await client.isContractDeployed(contract.address);
    if (ok) {
      console.log(`✅ Deployed: ${contract.address.toString()}`);
      console.log("Next: initialize jetton wallet discovery with:");
      console.log(`npx tsx scripts/init.ts --network ${network} ${contract.address.toString()}`);
      return;
    }
    process.stdout.write(".");
  }
  process.stdout.write("\n");
  console.log("⚠️ Deployment tx sent, but contract is not confirmed yet. Check on explorer.");
}

main().catch((err) => {
  console.error("Deploy failed:", err?.message ?? err);
  process.exit(1);
});

