import { Address } from "npm:@ton/core@0.60.0";
import { sha256 } from "npm:@ton/crypto@3.3.0";
import nacl from "npm:tweetnacl@1.0.3";

import { decodeBase64 } from "./base64.ts";

export type SignDataPayloadText = { type: "text"; text: string };
export type SignDataPayloadBinary = { type: "binary"; bytes: string };
export type SignDataPayload = SignDataPayloadText | SignDataPayloadBinary | { type: "cell" };

export type SignDataResponse = {
  signature: string; // base64
  address: string; // raw address
  timestamp: number; // seconds
  domain: string;
  payload: SignDataPayload;
};

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

function u32be(n: number): Uint8Array {
  const b = new ArrayBuffer(4);
  new DataView(b).setUint32(0, n >>> 0, false);
  return new Uint8Array(b);
}

function i32be(n: number): Uint8Array {
  const b = new ArrayBuffer(4);
  new DataView(b).setInt32(0, n | 0, false);
  return new Uint8Array(b);
}

function u64be(n: bigint): Uint8Array {
  const b = new ArrayBuffer(8);
  new DataView(b).setBigUint64(0, n, false);
  return new Uint8Array(b);
}

export async function verifySignDataText(params: {
  result: SignDataResponse;
  publicKeyHex: string; // 32-byte hex
}): Promise<boolean> {
  const { result } = params;
  if (result.payload?.type !== "text") return false;

  const parsedAddr = Address.parse(result.address);
  const domainBytes = new TextEncoder().encode(result.domain);
  const payloadBytes = new TextEncoder().encode(result.payload.text);

  const message = concatBytes([
    new Uint8Array([0xff, 0xff]),
    new TextEncoder().encode("ton-connect/sign-data/"),
    i32be(parsedAddr.workChain),
    parsedAddr.hash,
    u32be(domainBytes.length),
    domainBytes,
    u64be(BigInt(result.timestamp)),
    new TextEncoder().encode("txt"),
    u32be(payloadBytes.length),
    payloadBytes
  ]);

  const hash = await sha256(message);
  const sig = decodeBase64(result.signature);
  const pub = hexToBytes(params.publicKeyHex);

  return nacl.sign.detached.verify(new Uint8Array(hash), sig, pub);
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (!/^[0-9a-fA-F]+$/.test(clean) || clean.length % 2 !== 0) {
    throw new Error("INVALID_HEX");
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}
