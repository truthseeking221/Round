function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) throw new Error("INVALID_HEX");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function u256HexTo32Bytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (!/^[0-9a-fA-F]+$/.test(clean)) throw new Error("INVALID_HEX");
  if (clean.length > 64) throw new Error("INVALID_U256");
  return hexToBytes(clean.padStart(64, "0"));
}

type ToncenterRunGetMethodOk = { ok: true; result: { stack: unknown[] } };
type ToncenterRunGetMethodErr = { ok: false; error?: string; code?: number };
type ToncenterRunGetMethodResp = ToncenterRunGetMethodOk | ToncenterRunGetMethodErr;

export async function toncenterRunGetMethod(params: {
  address: string;
  method: string;
  stack?: unknown[];
}): Promise<ToncenterRunGetMethodResp> {
  const endpoint = Deno.env.get("TONCENTER_ENDPOINT") ?? "https://toncenter.com";
  const apiKey = Deno.env.get("TONCENTER_KEY");

  const url = new URL(`${endpoint.replace(/\/+$/g, "")}/api/v2/runGetMethod`);
  url.searchParams.set("address", params.address);
  url.searchParams.set("method", params.method);
  url.searchParams.set("stack", JSON.stringify(params.stack ?? []));
  if (apiKey) url.searchParams.set("api_key", apiKey);

  const res = await fetch(url.toString(), { method: "GET" });
  const json = (await res.json().catch(() => null)) as ToncenterRunGetMethodResp | null;
  if (!json || typeof json !== "object") {
    return { ok: false, error: "TONCENTER_BAD_RESPONSE", code: res.status };
  }
  return json;
}

export async function getWalletPublicKey(params: { walletAddress: string }): Promise<Uint8Array> {
  const r = await toncenterRunGetMethod({ address: params.walletAddress, method: "get_public_key" });
  if (!r.ok) {
    throw new Error(r.error ?? "TONCENTER_ERROR");
  }
  const stack = r.result.stack;
  if (!Array.isArray(stack) || stack.length < 1) {
    throw new Error("TONCENTER_STACK_EMPTY");
  }
  const item = stack[0];
  if (!Array.isArray(item) || item.length < 2) {
    throw new Error("TONCENTER_STACK_INVALID");
  }
  const type = String(item[0]);
  const value = String(item[1]);
  if (type !== "num") {
    throw new Error("TONCENTER_STACK_UNSUPPORTED");
  }
  return u256HexTo32Bytes(value);
}

