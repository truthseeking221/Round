import { Address, beginCell, Cell } from "@ton/core";
import { Buffer } from "buffer";

import { base64ToBytes, bytesToBase64 } from "./base64";

export const OP_JOIN_WITH_TICKET = 0x1001;
export const OP_COMMIT_BID = 0x3001;
export const OP_REVEAL_BID = 0x3002;
export const OP_WITHDRAW = 0x6001;

export function cellToBocBase64(cell: Cell): string {
  return bytesToBase64(cell.toBoc({ idx: false }));
}

export function buildJoinBody(params: { wallet: string; exp: number; nonce: bigint; sigB64: string }): string {
  const sig = base64ToBytes(params.sigB64);
  const body = beginCell()
    .storeUint(OP_JOIN_WITH_TICKET, 32)
    .storeAddress(Address.parse(params.wallet))
    .storeUint(params.exp, 32)
    .storeUint(params.nonce, 64)
    .storeBuffer(Buffer.from(sig))
    .endCell();
  return cellToBocBase64(body);
}

export function buildCommitBody(commitHash: bigint): string {
  return cellToBocBase64(beginCell().storeUint(OP_COMMIT_BID, 32).storeUint(commitHash, 256).endCell());
}

export function buildRevealBody(payoutWantedUnits: bigint, salt: bigint): string {
  return cellToBocBase64(beginCell().storeUint(OP_REVEAL_BID, 32).storeCoins(payoutWantedUnits).storeUint(salt, 256).endCell());
}

export function buildWithdrawBody(mode: number): string {
  return cellToBocBase64(beginCell().storeUint(OP_WITHDRAW, 32).storeUint(mode, 8).endCell());
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function randomU256(): bigint {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return BigInt(`0x${bytesToHex(b)}`);
}

export function buildBidCommitHash(params: {
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
