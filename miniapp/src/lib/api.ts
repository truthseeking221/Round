import { env } from "./env";

export type ApiError = { code: string; message?: string };

/**
 * MOCK MODE: Now requires explicit opt-in via VITE_ENABLE_MOCK=true
 * 
 * This prevents accidentally shipping mock mode to production when
 * VITE_FUNCTIONS_BASE_URL is forgotten.
 */
const MOCK_MODE = env.ENABLE_MOCK;

if (MOCK_MODE) {
  console.info("[API] Running in MOCK MODE - no backend connected. This should only be used for local development.");
}

// Fail hard if no backend URL and not in mock mode
if (!env.FUNCTIONS_BASE_URL && !MOCK_MODE) {
  console.error(
    "[API] FATAL: No backend URL configured and mock mode is disabled.\n" +
    "Set VITE_FUNCTIONS_BASE_URL or enable VITE_ENABLE_MOCK=true for development."
  );
}

async function apiFetch<T>(path: string, options: { method: string; token?: string; body?: unknown } = { method: "GET" }): Promise<T> {
  if (MOCK_MODE) {
    // Return mock data based on the endpoint
    return getMockResponse<T>(path, options);
  }

  const url = `${env.FUNCTIONS_BASE_URL!.replace(/\/$/, "")}/${path}`;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options.token) headers.authorization = `Bearer ${options.token}`;

  const res = await fetch(url, {
    method: options.method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const payload = (json ?? {}) as { error?: { code?: unknown; message?: unknown } };
    const err = typeof payload.error?.code === "string" ? payload.error.code : "API_ERROR";
    const message = typeof payload.error?.message === "string" ? payload.error.message : undefined;
    throw { code: err, message } satisfies ApiError;
  }
  return json as T;
}

// Mock responses for local development
function getMockResponse<T>(path: string, _options: { method: string; token?: string; body?: unknown }): T {
  void _options;
  // Simulate network delay
  return new Promise((resolve) => {
    setTimeout(() => {
      if (path === "auth-telegram") {
        resolve({
          session_token: "mock_session_token_12345",
          user: {
            telegram_user_id: 123456789,
            username: "testuser",
            first_name: "Test",
            last_name: "User",
            photo_url: null,
            language_code: "en"
          },
          group: {
            group_chat_id: -1001234567890,
            title: "Demo Circle Group",
            type: "supergroup",
            bot_present: true,
            bot_admin: true,
            last_checked_at: new Date().toISOString()
          }
        } as T);
      } else if (path === "circles-list") {
        resolve({
          circles: [
            {
              circle_id: "demo-circle-1",
              name: "Demo Weekly Circle",
              status: "Recruiting",
              contract_address: null,
              n_members: 5,
              contribution_units: "10000000", // 10 USDT
              current_cycle_index: 0,
              onchain_due_at: null,
              created_at: new Date().toISOString()
            },
            {
              circle_id: "demo-circle-2",
              name: "Demo Monthly Circle",
              status: "Active",
              contract_address: "EQDemo...Contract",
              n_members: 4,
              contribution_units: "50000000", // 50 USDT
              current_cycle_index: 2,
              onchain_due_at: new Date(Date.now() + 86400000 * 3).toISOString(),
              created_at: new Date(Date.now() - 86400000 * 30).toISOString()
            }
          ]
        } as T);
      } else if (path.startsWith("circles-status")) {
        resolve({
          circle: {
            circle_id: "demo-circle-1",
            group_chat_id: -1001234567890,
            name: "Demo Weekly Circle",
            status: "Recruiting",
            contract_address: null,
            jetton_master: null,
            n_members: 5,
            contribution_units: "10000000",
            total_cycles: 5,
            interval_sec: 604800,
            grace_sec: 86400,
            take_rate_bps: 100,
            collateral_rate_bps: 1000,
            max_discount_bps: 500,
            vesting_bps_cycle1: 2000,
            early_lock_rate_bps_cycle1: 3000,
            commit_duration_sec: 1800,
            reveal_duration_sec: 1800,
            max_pot_cap_units: "1000000000",
            min_deposit_units: "100000",
            current_cycle_index: 0,
            onchain_phase: null,
            onchain_funded_count: null,
            onchain_jetton_wallet: null,
            onchain_due_at: null,
            onchain_grace_end_at: null,
            onchain_commit_end_at: null,
            onchain_reveal_end_at: null,
            last_indexer_attempt_at: null,
            last_indexed_at: null,
            last_indexer_error: null
          },
          member: null
        } as T);
      } else if (path === "circles-create") {
        resolve({ ok: true, circle: { circle_id: "new-demo-circle", status: "Recruiting" } } as T);
      } else if (path === "circles-join") {
        resolve({ ok: true, member: { join_status: "joined" } } as T);
      } else {
        // Default mock response
        resolve({ ok: true, mock: true } as T);
      }
    }, 300);
  }) as T;
}

export type TgUser = {
  telegram_user_id: number;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  photo_url: string | null;
  language_code: string | null;
};

export type TgGroup = {
  group_chat_id: number;
  title: string | null;
  type: string | null;
  bot_present: boolean;
  bot_admin: boolean;
  last_checked_at: string | null;
};

export type AuthTelegramResponse = {
  session_token: string;
  user: TgUser;
  group: TgGroup | null;
};

export async function authTelegram(initData: string): Promise<AuthTelegramResponse> {
  return await apiFetch<AuthTelegramResponse>("auth-telegram", { method: "POST", body: { initData } });
}

export type CirclesListResponse = {
  circles: Array<{
    circle_id: string;
    name?: string | null;
    status: string;
    contract_address?: string | null;
    n_members: number;
    contribution_units: string;
    current_cycle_index: number;
    onchain_due_at?: string | null;
    onchain_grace_end_at?: string | null;
    onchain_commit_end_at?: string | null;
    onchain_reveal_end_at?: string | null;
    last_indexed_at?: string | null;
    last_indexer_error?: string | null;
    created_at: string;
  }>;
};

export async function listCircles(token: string): Promise<CirclesListResponse> {
  return await apiFetch<CirclesListResponse>("circles-list", { method: "GET", token });
}

export type CircleRecord = {
  circle_id: string;
  group_chat_id: number;
  name: string | null;
  status: string;
  contract_address: string | null;
  jetton_master: string | null;
  n_members: number;
  contribution_units: string;
  total_cycles: number;
  interval_sec: number;
  grace_sec: number;
  take_rate_bps: number;
  collateral_rate_bps: number;
  max_discount_bps: number;
  vesting_bps_cycle1: number;
  early_lock_rate_bps_cycle1: number;
  commit_duration_sec: number;
  reveal_duration_sec: number;
  max_pot_cap_units: string;
  min_deposit_units: string;
  current_cycle_index: number;
  onchain_phase: number | null;
  onchain_funded_count: number | null;
  onchain_jetton_wallet: string | null;
  onchain_due_at: string | null;
  onchain_grace_end_at: string | null;
  onchain_commit_end_at: string | null;
  onchain_reveal_end_at: string | null;
  last_indexer_attempt_at: string | null;
  last_indexed_at: string | null;
  last_indexer_error: string | null;
};

export type CircleMemberRecord = {
  join_status: string;
  wallet_address: string | null;
  rules_signature_hash: string | null;
  has_won: boolean;
  collateral: string;
  prefund: string;
  credit: string;
  vesting_locked: string;
  vesting_released: string;
  future_locked: string;
  withdrawable: string;
  due_remaining: string;
};

export type CircleStatusResponse = { circle: CircleRecord; member: CircleMemberRecord | null };

export async function getCircleStatus(token: string, circleId: string): Promise<CircleStatusResponse> {
  const q = new URLSearchParams({ circle_id: circleId });
  return await apiFetch<CircleStatusResponse>(`circles-status?${q.toString()}`, { method: "GET", token });
}

export type CreateCircleResponse = { ok: true; circle: CircleRecord };

export async function createCircle(
  token: string,
  params: { name?: string; n_members: number; contribution_usdt: string; interval: "weekly" | "monthly" }
): Promise<CreateCircleResponse> {
  return await apiFetch<CreateCircleResponse>("circles-create", { method: "POST", token, body: params });
}

export type JoinCircleResponse = { ok: true; member: CircleMemberRecord };

export async function joinCircle(token: string, circleId: string): Promise<JoinCircleResponse> {
  return await apiFetch<JoinCircleResponse>("circles-join", { method: "POST", token, body: { circle_id: circleId } });
}

export type AcceptRulesResponse = { ok: true; member: CircleMemberRecord };

export async function acceptRules(token: string, circleId: string, rulesSignatureHash: string): Promise<AcceptRulesResponse> {
  return await apiFetch<AcceptRulesResponse>("circles-accept-rules", {
    method: "POST",
    token,
    body: { circle_id: circleId, rules_signature_hash: rulesSignatureHash }
  });
}

export async function walletBindChallenge(token: string, circleId: string): Promise<{ nonce: string; exp: number; message_to_sign: string }> {
  return await apiFetch<{ nonce: string; exp: number; message_to_sign: string }>("wallet-bind-challenge", {
    method: "POST",
    token,
    body: { circle_id: circleId }
  });
}

export type WalletBindConfirmResponse = { ok: true; wallet_address: string; member: CircleMemberRecord };

export async function walletBindConfirm(token: string, circleId: string, signData: unknown): Promise<WalletBindConfirmResponse> {
  return await apiFetch<WalletBindConfirmResponse>("wallet-bind-confirm", { method: "POST", token, body: { circle_id: circleId, sign_data: signData } });
}

export type JoinTicketResponse = { wallet: string; exp: number; nonce: string; sig: string; contract_address: string };

export async function joinTicket(token: string, circleId: string): Promise<JoinTicketResponse> {
  return await apiFetch<JoinTicketResponse>("circles-join-ticket", { method: "POST", token, body: { circle_id: circleId } });
}

export type AttachContractResponse = { ok: true; circle: CircleRecord };

export async function attachContract(token: string, params: { circle_id: string; contract_address: string }): Promise<AttachContractResponse> {
  return await apiFetch<AttachContractResponse>("circles-attach-contract", { method: "POST", token, body: params });
}

export type DepositIntentResponse = {
  ok: true;
  jetton_master: string;
  jetton_wallet: string;
  to_contract: string;
  amount_units: string;
  tx_value_nano: string;
  payload_base64: string;
};

export async function depositIntent(
  token: string,
  params: { circle_id: string; purpose: "collateral" | "prefund"; amount_usdt: string | number }
): Promise<DepositIntentResponse> {
  return await apiFetch<DepositIntentResponse>("circles-deposit-intent", { method: "POST", token, body: params });
}
