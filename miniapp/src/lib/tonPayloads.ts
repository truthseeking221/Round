import { Address, beginCell, type Cell } from "@ton/core";
import { Buffer } from "buffer";

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function toNano(ton: string): string {
  const t = ton.trim();
  if (!/^\d+(\.\d+)?$/.test(t)) throw new Error("BAD_TON_AMOUNT");
  const [a, b = ""] = t.split(".");
  const frac = (b + "000000000").slice(0, 9);
  return (BigInt(a) * 1_000_000_000n + BigInt(frac)).toString();
}

function cellToPayloadBase64(cell: Cell): string {
  const boc: Uint8Array = cell.toBoc({ idx: false });
  return bytesToBase64(boc);
}

function randomU64(): bigint {
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  let n = 0n;
  for (const v of b) n = (n << 8n) | BigInt(v);
  return n;
}

export function buildWithdrawPayload(mode: 1 | 2 | 3): string {
  const OP_WITHDRAW = 0x6001;
  const c = beginCell().storeUint(OP_WITHDRAW, 32).storeUint(mode, 8).endCell();
  return cellToPayloadBase64(c);
}

export function buildTriggerDebitAllPayload(): string {
  const OP_TRIGGER_DEBIT_ALL = 0x2001;
  return cellToPayloadBase64(beginCell().storeUint(OP_TRIGGER_DEBIT_ALL, 32).endCell());
}

export function buildFinalizeAuctionPayload(): string {
  const OP_FINALIZE_AUCTION = 0x3003;
  return cellToPayloadBase64(beginCell().storeUint(OP_FINALIZE_AUCTION, 32).endCell());
}

export function buildTerminateDefaultPayload(): string {
  const OP_TERMINATE_DEFAULT = 0x4001;
  return cellToPayloadBase64(beginCell().storeUint(OP_TERMINATE_DEFAULT, 32).endCell());
}

export function buildInitJettonWalletPayload(): string {
  const OP_INIT = 0xa001;
  return cellToPayloadBase64(beginCell().storeUint(OP_INIT, 32).endCell());
}

export function buildJoinWithTicketPayload(ticket: {
  wallet: string;
  exp: number;
  nonce: string;
  sig: string;
}): string {
  const OP_JOIN_WITH_TICKET = 0x1001;
  const wallet = Address.parse(ticket.wallet);
  const exp = Number(ticket.exp);
  const nonce = BigInt(ticket.nonce);
  const sigBytes = base64ToBytes(ticket.sig);
  if (sigBytes.length !== 64) throw new Error("BAD_TICKET_SIG");

  const c = beginCell()
    .storeUint(OP_JOIN_WITH_TICKET, 32)
    .storeAddress(wallet)
    .storeUint(exp, 32)
    .storeUint(nonce, 64)
    .storeBuffer(Buffer.from(sigBytes))
    .endCell();
  return cellToPayloadBase64(c);
}

export function buildJettonDepositTransferPayload(params: {
  amountUnits: bigint;
  destinationJettonWallet: string;
  responseDestination: string;
  purpose: "collateral" | "prefund";
  forwardTonAmountNano: bigint;
  queryId?: bigint;
}): string {
  const OP_JETTON_TRANSFER = 0x0f8a7ea5;
  const DEPOSIT_MAGIC = 0xc0ffee01;
  const PURPOSE_COLLATERAL = 1;
  const PURPOSE_PREFUND = 2;

  const qid = params.queryId ?? randomU64();
  const purpose = params.purpose === "collateral" ? PURPOSE_COLLATERAL : PURPOSE_PREFUND;

  const c = beginCell()
    .storeUint(OP_JETTON_TRANSFER, 32)
    .storeUint(qid, 64)
    .storeCoins(params.amountUnits)
    .storeAddress(Address.parse(params.destinationJettonWallet))
    .storeAddress(Address.parse(params.responseDestination))
    .storeBit(false) // custom_payload = null
    .storeCoins(params.forwardTonAmountNano)
    // forward_payload: Either Cell ^Cell — inline for robust parsing on recipient
    .storeBit(false)
    .storeUint(DEPOSIT_MAGIC, 32)
    .storeUint(purpose, 8)
    .endCell();

  return cellToPayloadBase64(c);
}

// ============================================
// AUCTION PAYLOADS
// ============================================

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function parseUsdtAmount(usdt: string): bigint {
  const cleaned = usdt.trim();
  if (!/^\d+(\.\d+)?$/.test(cleaned)) throw new Error("Invalid USDT amount");
  const [whole, frac = ""] = cleaned.split(".");
  const fracPadded = (frac + "000000").slice(0, 6);
  return BigInt(whole) * 1_000_000n + BigInt(fracPadded);
}

/**
 * Build domain-separated commit hash matching contract's _hashBid:
 * H("MC_BID"|contract|cycle|wallet|payoutWanted|salt)
 * 
 * CRITICAL: This must match the contract exactly or reveal will fail with HASH_MISMATCH
 * and user will be penalized (lose collateral).
 */
function buildBidCommitHash(params: {
  contractAddress: string;
  cycleIndex: number;
  walletAddress: string;
  payoutWantedUnits: bigint;
  salt: bigint;
}): bigint {
  const hash = beginCell()
    .storeUint(0x4d43, 16) // "MC"
    .storeUint(0x5f424944, 32) // "_BID"
    .storeAddress(Address.parse(params.contractAddress))
    .storeUint(params.cycleIndex, 16)
    .storeAddress(Address.parse(params.walletAddress))
    .storeCoins(params.payoutWantedUnits)
    .storeUint(params.salt, 256)
    .endCell()
    .hash();
  return BigInt(`0x${bytesToHex(hash)}`);
}

export type BidParams = {
  bidAmountUsdt: string;
  saltString: string;
  contractAddress: string;
  cycleIndex: number;
  walletAddress: string;
};

type RevealFromStorageParams = { fromStorage: true };

function isRevealFromStorage(params: BidParams | RevealFromStorageParams): params is RevealFromStorageParams {
  return (params as RevealFromStorageParams).fromStorage === true;
}

/**
 * Build commit bid payload for auction
 * 
 * IMPORTANT: All parameters are REQUIRED for correct domain-separated hash.
 * Using incorrect params will cause reveal to fail and user loses collateral.
 * 
 * @param params.bidAmountUsdt - The payout amount user wants (in USDT, e.g. "95.50")
 * @param params.saltString - User's secret salt string
 * @param params.contractAddress - Circle contract address (EQ...)
 * @param params.cycleIndex - Current cycle index from contract state
 * @param params.walletAddress - User's TON wallet address (EQ...)
 */
export async function buildCommitBidPayload(params: BidParams): Promise<{ payload: string; salt: bigint; payoutUnits: bigint }> {
  const OP_COMMIT_BID = 0x3001;
  
  const payoutUnits = parseUsdtAmount(params.bidAmountUsdt);
  
  // Generate salt from user input (hash it for consistency and to get 256-bit value)
  const saltBytes = new TextEncoder().encode(params.saltString);
  const saltHash = await crypto.subtle.digest("SHA-256", saltBytes);
  const salt = BigInt(`0x${bytesToHex(new Uint8Array(saltHash))}`);
  
  // Build commit hash with FULL domain separation - matches contract's _hashBid exactly
  const commitHash = buildBidCommitHash({
    contractAddress: params.contractAddress,
    cycleIndex: params.cycleIndex,
    walletAddress: params.walletAddress,
    payoutWantedUnits: payoutUnits,
    salt,
  });
  
  // Store for reveal phase (include all params for verification)
  const storedBid = {
    contractAddress: params.contractAddress,
    cycleIndex: params.cycleIndex,
    walletAddress: params.walletAddress,
    payoutUnits: payoutUnits.toString(),
    salt: salt.toString(),
    commitHash: commitHash.toString(),
    createdAt: Date.now(),
  };
  localStorage.setItem("mc_bid_data", JSON.stringify(storedBid));
  
  const c = beginCell()
    .storeUint(OP_COMMIT_BID, 32)
    .storeUint(commitHash, 256)
    .endCell();
  
  return {
    payload: cellToPayloadBase64(c),
    salt,
    payoutUnits,
  };
}

/**
 * Get stored bid data for reveal phase
 */
export function getStoredBidData(): {
  contractAddress: string;
  cycleIndex: number;
  walletAddress: string;
  payoutUnits: bigint;
  salt: bigint;
  commitHash: bigint;
} | null {
  const stored = localStorage.getItem("mc_bid_data");
  if (!stored) return null;
  
  try {
    const data = JSON.parse(stored);
    return {
      contractAddress: data.contractAddress,
      cycleIndex: data.cycleIndex,
      walletAddress: data.walletAddress,
      payoutUnits: BigInt(data.payoutUnits),
      salt: BigInt(data.salt),
      commitHash: BigInt(data.commitHash),
    };
  } catch {
    return null;
  }
}

/**
 * Build reveal bid payload for auction
 * 
 * Uses stored bid data to ensure consistency with commit.
 * Also accepts explicit params for cases where user needs to re-enter.
 */
export async function buildRevealBidPayload(
  params: BidParams | RevealFromStorageParams
): Promise<{ payload: string; payoutUnits: bigint; salt: bigint }> {
  const OP_REVEAL_BID = 0x3002;
  
  let payoutUnits: bigint;
  let salt: bigint;
  
  if (isRevealFromStorage(params)) {
    // Use stored data
    const stored = getStoredBidData();
    if (!stored) {
      throw new Error("NO_STORED_BID: No bid data found. Please re-enter your bid details.");
    }
    payoutUnits = stored.payoutUnits;
    salt = stored.salt;
  } else {
    // Regenerate from params
    payoutUnits = parseUsdtAmount(params.bidAmountUsdt);
    const saltBytes = new TextEncoder().encode(params.saltString);
    const saltHash = await crypto.subtle.digest("SHA-256", saltBytes);
    salt = BigInt(`0x${bytesToHex(new Uint8Array(saltHash))}`);
  }
  
  const c = beginCell()
    .storeUint(OP_REVEAL_BID, 32)
    .storeCoins(payoutUnits)
    .storeUint(salt, 256)
    .endCell();
  
  return {
    payload: cellToPayloadBase64(c),
    payoutUnits,
    salt,
  };
}

/**
 * Clear stored bid data after successful reveal or cycle end
 */
export function clearStoredBidData(): void {
  localStorage.removeItem("mc_bid_data");
}
