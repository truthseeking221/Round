import { toncenterRunGetMethod } from "./ton.ts";

export async function fetchAccountPublicKey(params: { account: string }): Promise<string | null> {
  const baseUrl = Deno.env.get("TONAPI_BASE_URL") ?? "https://tonapi.io";
  const url = `${baseUrl.replace(/\/$/, "")}/v2/accounts/${encodeURIComponent(params.account)}/publickey`;

  const headers: Record<string, string> = {};
  const key = Deno.env.get("TONAPI_KEY");
  if (key) headers["authorization"] = `Bearer ${key}`;

  const res = await fetch(url, { headers });
  if (!res.ok) return null;
  const json = (await res.json().catch(() => null)) as { public_key?: string } | null;
  const pk = json?.public_key;
  if (!pk || typeof pk !== "string") return null;
  return pk;
}

export type TonapiBlockchainAccount = {
  address: string;
  status?: string;
  code_hash?: string;
};

export async function tonapiGetBlockchainAccount(params: { account: string }): Promise<TonapiBlockchainAccount | null> {
  const baseUrl = Deno.env.get("TONAPI_BASE_URL") ?? "https://tonapi.io";
  const url = `${baseUrl.replace(/\/$/, "")}/v2/blockchain/accounts/${encodeURIComponent(params.account)}`;

  const headers: Record<string, string> = {};
  const key = Deno.env.get("TONAPI_KEY");
  if (key) headers["authorization"] = `Bearer ${key}`;

  const res = await fetch(url, { headers });
  if (!res.ok) return null;
  const json = (await res.json().catch(() => null)) as TonapiBlockchainAccount | null;
  if (!json || typeof json !== "object") return null;
  if (!json.address || typeof json.address !== "string") return null;
  return json;
}

export async function tonapiGetJettonWalletAddress(params: { owner: string; jettonMaster: string }): Promise<string | null> {
  const baseUrl = Deno.env.get("TONAPI_BASE_URL") ?? "https://tonapi.io";
  const url = `${baseUrl.replace(/\/$/, "")}/v2/accounts/${encodeURIComponent(params.owner)}/jettons`;

  const headers: Record<string, string> = {};
  const key = Deno.env.get("TONAPI_KEY");
  if (key) headers["authorization"] = `Bearer ${key}`;

  const res = await fetch(url, { headers });
  if (!res.ok) return null;
  const json = (await res.json().catch(() => null)) as any;
  const balances = Array.isArray(json?.balances) ? json.balances : [];
  const want = String(params.jettonMaster).toLowerCase();

  for (const b of balances) {
    const jettonAddr = String(b?.jetton?.address ?? b?.jetton?.jetton_address ?? b?.jetton_address ?? "").toLowerCase();
    if (!jettonAddr || jettonAddr !== want) continue;
    const wa = b?.wallet_address?.address ?? b?.wallet_address ?? b?.wallet?.address ?? null;
    if (typeof wa === "string" && wa.length > 0) return wa;
  }
  return null;
}

export type TonapiMethodExecutionResult = {
  success: boolean;
  exit_code: number;
  stack: unknown[];
  decoded?: unknown;
};

// Run get method with TonAPI as primary, Toncenter as fallback
export async function tonapiRunGetMethod(params: {
  account: string;
  method: string;
  args?: string[];
}): Promise<TonapiMethodExecutionResult | null> {
  // Try TonAPI first
  const tonapiResult = await tryTonapiRunGetMethod(params);
  if (tonapiResult) {
    return tonapiResult;
  }

  // Fallback to Toncenter
  console.warn(`[PROVIDER_FALLBACK] TonAPI failed for ${params.method}, trying Toncenter`);
  return tryToncenterRunGetMethod(params);
}

// TonAPI implementation
async function tryTonapiRunGetMethod(params: {
  account: string;
  method: string;
  args?: string[];
}): Promise<TonapiMethodExecutionResult | null> {
  try {
    const baseUrl = Deno.env.get("TONAPI_BASE_URL") ?? "https://tonapi.io";
    const url = new URL(
      `${baseUrl.replace(/\/$/, "")}/v2/blockchain/accounts/${encodeURIComponent(params.account)}/methods/${encodeURIComponent(params.method)}`
    );
    for (const a of params.args ?? []) url.searchParams.append("args", a);

    const headers: Record<string, string> = {};
    const key = Deno.env.get("TONAPI_KEY");
    if (key) headers["authorization"] = `Bearer ${key}`;

    const res = await fetch(url.toString(), { headers });
    if (!res.ok) return null;
    const json = (await res.json().catch(() => null)) as TonapiMethodExecutionResult | null;
    if (!json || typeof json !== "object") return null;
    return json;
  } catch (e) {
    console.error("[TONAPI_ERROR]", e);
    return null;
  }
}

// Toncenter fallback implementation
async function tryToncenterRunGetMethod(params: {
  account: string;
  method: string;
  args?: string[];
}): Promise<TonapiMethodExecutionResult | null> {
  try {
    // Convert args to Toncenter stack format
    const stack: unknown[] = (params.args ?? []).map((arg) => {
      // Detect if arg is an address or a number
      if (arg.includes(":") || arg.length === 48 || arg.length === 66) {
        // Likely an address - pass as slice
        return ["tvm.Slice", arg];
      }
      // Assume number
      return ["num", arg];
    });

    const result = await toncenterRunGetMethod({
      address: params.account,
      method: params.method,
      stack,
    });

    if (!result.ok) {
      console.error("[TONCENTER_ERROR]", result.error);
      return null;
    }

    // Convert Toncenter response to TonAPI format
    return {
      success: true,
      exit_code: 0,
      stack: result.result.stack,
    };
  } catch (e) {
    console.error("[TONCENTER_ERROR]", e);
    return null;
  }
}

// Run get method with explicit provider choice (for retry logic)
export async function runGetMethodWithRetry(params: {
  account: string;
  method: string;
  args?: string[];
  maxRetries?: number;
}): Promise<TonapiMethodExecutionResult | null> {
  const maxRetries = params.maxRetries ?? 3;
  let lastError: unknown = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const result = await tonapiRunGetMethod(params);
      if (result) return result;
    } catch (e) {
      lastError = e;
      console.warn(`[GET_METHOD_RETRY] Attempt ${attempt + 1}/${maxRetries} failed for ${params.method}`);
    }

    // Exponential backoff
    if (attempt < maxRetries - 1) {
      await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt) * 1000));
    }
  }

  console.error("[GET_METHOD_FAILED]", params.method, lastError);
  return null;
}
