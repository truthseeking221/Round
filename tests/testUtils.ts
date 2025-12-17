import { expect } from "vitest";
import type { SandboxContract, TreasuryContract } from "@ton/sandbox";
import { Address, Cell, beginCell, toNano } from "@ton/core";
import { sign } from "@ton/crypto";

export const OP_JOIN_WITH_TICKET = 0x1001;
export const OP_TRIGGER_DEBIT_ALL = 0x2001;
export const OP_COMMIT_BID = 0x3001;
export const OP_REVEAL_BID = 0x3002;
export const OP_FINALIZE_AUCTION = 0x3003;
export const OP_TERMINATE_DEFAULT = 0x4001;
export const OP_WITHDRAW = 0x6001;
export const OP_WITHDRAW_TREASURY = 0x7001;
export const OP_EMERGENCY_STOP = 0x9001;

export const OP_JETTON_TRANSFER_NOTIFICATION = 0x7362d09c;
export const OP_TAKE_WALLET_ADDRESS = 0x3;

export const OP_TEST_SEND_NOTIFICATION = 0xaa01;
export const OP_TEST_SET_BOUNCE = 0xaa02;
export const OP_TEST_SEND_NOTIFICATION_MALFORMED = 0xaa03;

export const DEPOSIT_MAGIC = 0xc0ffee01;
export const PURPOSE_COLLATERAL = 1;
export const PURPOSE_PREFUND = 2;

export function u256From(buf: Buffer): bigint {
  return BigInt(`0x${buf.toString("hex")}`);
}

export function buildJoinHash(contract: Address, wallet: Address, exp: number, nonce: bigint): Buffer {
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

export function buildBidHash(contract: Address, cycleIndex: number, wallet: Address, payoutWanted: bigint, salt: bigint): Buffer {
  return beginCell()
    .storeUint(0x4d43, 16) // "MC"
    .storeUint(0x5f424944, 32) // "_BID"
    .storeAddress(contract)
    .storeUint(cycleIndex, 16)
    .storeAddress(wallet)
    .storeCoins(payoutWanted)
    .storeUint(salt, 256)
    .endCell()
    .hash();
}

export function buildStopHash(contract: Address, reason: number, exp: number, nonce: bigint): Buffer {
  return beginCell()
    .storeUint(0x4d43, 16) // "MC"
    .storeUint(0x5f53544f50, 40) // "_STOP"
    .storeAddress(contract)
    .storeUint(reason, 32)
    .storeUint(exp, 32)
    .storeUint(nonce, 64)
    .endCell()
    .hash();
}

export async function sendBody(from: SandboxContract<TreasuryContract>, to: Address, body: Cell, value: bigint) {
  return await from.send({
    to,
    value,
    body
  });
}

export async function deployContract(contract: SandboxContract<any>, via: SandboxContract<TreasuryContract>, value: bigint) {
  await contract.send(via.getSender(), { value }, { $$type: "Deploy", queryId: 0n });
}

export function txTo(result: any, address: Address) {
  const target = address.toString();
  return result.transactions.find((t: any) => t.inMessage?.info?.dest?.toString?.() === target);
}

export function expectTxSuccess(result: any, address: Address) {
  const tx = txTo(result, address);
  expect(tx?.description?.computePhase?.success).toBe(true);
}

export function expectTxFail(result: any, address: Address, exitCode?: number) {
  const tx = txTo(result, address);
  expect(tx?.description?.computePhase?.success).toBe(false);
  if (exitCode !== undefined) {
    expect(tx?.description?.computePhase?.exitCode).toBe(exitCode);
  }
}

export function buildTakeWalletBody(jettonWallet: Address, queryId = 1): Cell {
  return beginCell().storeUint(OP_TAKE_WALLET_ADDRESS, 32).storeUint(queryId, 64).storeAddress(jettonWallet).endCell();
}

export function buildJoinBody(contract: Address, wallet: Address, exp: number, nonce: bigint, guardianSecretKey: Buffer): Cell {
  const sig = sign(buildJoinHash(contract, wallet, exp, nonce), guardianSecretKey);
  return beginCell()
    .storeUint(OP_JOIN_WITH_TICKET, 32)
    .storeAddress(wallet)
    .storeUint(exp, 32)
    .storeUint(nonce, 64)
    .storeBuffer(sig)
    .endCell();
}

export function buildCommitBody(commitHash: bigint): Cell {
  return beginCell().storeUint(OP_COMMIT_BID, 32).storeUint(commitHash, 256).endCell();
}

export function buildRevealBody(payoutWanted: bigint, salt: bigint): Cell {
  return beginCell().storeUint(OP_REVEAL_BID, 32).storeCoins(payoutWanted).storeUint(salt, 256).endCell();
}

export function buildFinalizeBody(): Cell {
  return beginCell().storeUint(OP_FINALIZE_AUCTION, 32).endCell();
}

export function buildTriggerDebitAllBody(): Cell {
  return beginCell().storeUint(OP_TRIGGER_DEBIT_ALL, 32).endCell();
}

export function buildTerminateDefaultBody(): Cell {
  return beginCell().storeUint(OP_TERMINATE_DEFAULT, 32).endCell();
}

export function buildWithdrawBody(mode: number): Cell {
  return beginCell().storeUint(OP_WITHDRAW, 32).storeUint(mode, 8).endCell();
}

export function buildWithdrawTreasuryBody(): Cell {
  return beginCell().storeUint(OP_WITHDRAW_TREASURY, 32).endCell();
}

export function buildStopBody(contract: Address, reason: number, exp: number, nonce: bigint, guardianSecretKey: Buffer): Cell {
  const sig = sign(buildStopHash(contract, reason, exp, nonce), guardianSecretKey);
  return beginCell()
    .storeUint(OP_EMERGENCY_STOP, 32)
    .storeUint(reason, 32)
    .storeUint(exp, 32)
    .storeUint(nonce, 64)
    .storeBuffer(sig)
    .endCell();
}

export function buildTestNotificationBody(target: Address, queryId: number, amount: bigint, fromOwner: Address, purpose: number): Cell {
  return beginCell()
    .storeUint(OP_TEST_SEND_NOTIFICATION, 32)
    .storeAddress(target)
    .storeUint(queryId, 64)
    .storeCoins(amount)
    .storeAddress(fromOwner)
    .storeUint(purpose, 8)
    .endCell();
}

export function buildTestNotificationMalformedBody(target: Address, queryId: number, amount: bigint, fromOwner: Address, malformedKind: number): Cell {
  return beginCell()
    .storeUint(OP_TEST_SEND_NOTIFICATION_MALFORMED, 32)
    .storeAddress(target)
    .storeUint(queryId, 64)
    .storeCoins(amount)
    .storeAddress(fromOwner)
    .storeUint(malformedKind, 8)
    .endCell();
}

export function buildSpoofedTransferNotificationBody(queryId: number, amount: bigint, fromOwner: Address, purpose = PURPOSE_PREFUND): Cell {
  return beginCell()
    .storeUint(OP_JETTON_TRANSFER_NOTIFICATION, 32)
    .storeUint(queryId, 64)
    .storeCoins(amount)
    .storeAddress(fromOwner)
    .storeBit(false)
    .storeUint(DEPOSIT_MAGIC, 32)
    .storeUint(purpose, 8)
    .endCell();
}

export const TON_0_2 = toNano("0.2");
