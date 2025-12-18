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

function randomU256(): bigint {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return BigInt(`0x${bytesToHex(b)}`);
}

function parseUsdtAmount(usdt: string): bigint {
  const cleaned = usdt.trim();
  if (!/^\d+(\.\d+)?$/.test(cleaned)) throw new Error("Invalid USDT amount");
  const [whole, frac = ""] = cleaned.split(".");
  const fracPadded = (frac + "000000").slice(0, 6);
  return BigInt(whole) * 1_000_000n + BigInt(fracPadded);
}

/**
 * Build commit bid payload for auction
 * Stores the bid locally and returns the payload to send on-chain
 */
export async function buildCommitBidPayload(bidAmountUsdt: string, saltString: string): Promise<string> {
  const OP_COMMIT_BID = 0x3001;
  
  const payoutUnits = parseUsdtAmount(bidAmountUsdt);
  
  // Generate salt from user input (hash it for consistency)
  const saltBytes = new TextEncoder().encode(saltString);
  const saltHash = await crypto.subtle.digest("SHA-256", saltBytes);
  const salt = BigInt(`0x${bytesToHex(new Uint8Array(saltHash))}`);
  
  // Build commit hash: H("MC_BID"|contract|cycle|wallet|payoutWanted|salt)
  // Note: In real implementation, this needs contract address and wallet from context
  // For now, we just hash the bid data - the full hash is built in the contract
  const commitData = beginCell()
    .storeCoins(payoutUnits)
    .storeUint(salt, 256)
    .endCell();
  
  const commitHash = BigInt(`0x${bytesToHex(commitData.hash())}`);
  
  // Store for reveal phase
  localStorage.setItem("mc_bid_payout", payoutUnits.toString());
  localStorage.setItem("mc_bid_salt", salt.toString());
  
  const c = beginCell()
    .storeUint(OP_COMMIT_BID, 32)
    .storeUint(commitHash, 256)
    .endCell();
  
  return cellToPayloadBase64(c);
}

/**
 * Build reveal bid payload for auction
 * Retrieves stored bid data and reveals it on-chain
 */
export async function buildRevealBidPayload(bidAmountUsdt: string, saltString: string): Promise<string> {
  const OP_REVEAL_BID = 0x3002;
  
  const payoutUnits = parseUsdtAmount(bidAmountUsdt);
  
  // Regenerate salt from user input
  const saltBytes = new TextEncoder().encode(saltString);
  const saltHash = await crypto.subtle.digest("SHA-256", saltBytes);
  const salt = BigInt(`0x${bytesToHex(new Uint8Array(saltHash))}`);
  
  const c = beginCell()
    .storeUint(OP_REVEAL_BID, 32)
    .storeCoins(payoutUnits)
    .storeUint(salt, 256)
    .endCell();
  
  return cellToPayloadBase64(c);
}
