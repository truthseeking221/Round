# Backend Edge Functions

Supabase Edge Functions for MoneyCircle backend.

## Endpoints

### Authentication

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/auth-telegram` | POST | None | Verify Telegram initData, issue session token |

### Circles

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/circles-list` | GET | Session | List circles for current group |
| `/circles-status` | GET | Session | Get circle details + member status |
| `/circles-create` | POST | Session | Create new circle in group |
| `/circles-join` | POST | Session | Join a circle |
| `/circles-accept-rules` | POST | Session | Accept circle rules |
| `/circles-join-ticket` | POST | Session | Get signed ticket for on-chain join |
| `/circles-attach-contract` | POST | Session | Link deployed contract to circle |
| `/circles-deposit-intent` | POST | Session | Record deposit intent for UI |

### Wallet

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/wallet-bind-challenge` | POST | Session | Get wallet bind challenge (nonce + message) |
| `/wallet-bind-confirm` | POST | Session | Verify wallet signature, bind to user |
| `/jetton-wallet-address` | POST | Session | Get user's jetton wallet address |

### Group

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/group-verify` | GET | Session | Verify user is in Telegram group |

### System

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/indexer-sync` | POST | Cron Secret | Sync on-chain state to DB |
| `/notify-scheduler` | POST | Cron Secret | Schedule notification messages |
| `/bot-sender` | POST | Cron Secret | Send pending bot notifications |
| `/ops-health-check` | POST | Cron Secret | Optional ops alerts (indexer lag/error) |
| `/tx-notify` | POST | Session | Notify backend of user's tx (optional) |

## Shared Modules (`_shared/`)

| Module | Description |
|--------|-------------|
| `auth.ts` | Session validation |
| `http.ts` | CORS, JSON response, error handling |
| `supabase.ts` | Supabase client factory |
| `telegram.ts` | Telegram initData verification |
| `telegram-api.ts` | Telegram Bot API helpers |
| `ton.ts` | Toncenter API helpers |
| `tonapi.ts` | TonAPI helpers + fallback |
| `tvm.ts` | TVM stack parsing utilities |
| `sign-data.ts` | TonConnect sign-data verification |
| `base64.ts` | Base64 encode/decode |
| `usdt.ts` | USDT units parsing |
| `rate-limit.ts` | Fixed-window rate limit helper (RPC-based) |

## Authentication Flow

```
1. User opens Mini App
2. Frontend sends initData to /auth-telegram
3. Backend verifies initData, creates session
4. Frontend stores session_token
5. All subsequent requests include: Authorization: Bearer <session_token>
```

## CORS Configuration

Allowed origins (configurable via `CORS_ALLOWED_ORIGINS`):
- `https://web.telegram.org`
- `https://t.me`
- `http://localhost:5173` (dev)
- `http://localhost:3000` (dev)

## Error Codes

| Code | HTTP | Description |
|------|------|-------------|
| `AUTH_INVALID` | 401 | Invalid/missing session |
| `AUTH_EXPIRED` | 401 | Session expired |
| `TG_INITDATA_INVALID` | 400 | Bad Telegram initData |
| `TG_INITDATA_EXPIRED` | 401 | initData too old |
| `TG_NOT_IN_GROUP` | 403 | User not in group |
| `TG_BANNED` | 403 | User banned from group |
| `CIRCLE_NOT_FOUND` | 404 | Circle doesn't exist |
| `CIRCLE_NOT_RECRUITING` | 400 | Circle not accepting joins |
| `NOT_JOINED` | 400 | User not a member |
| `RULES_NOT_ACCEPTED` | 400 | Must accept rules first |
| `WALLET_NOT_VERIFIED` | 400 | Must verify wallet first |
| `WALLET_ALREADY_BOUND` | 400 | Wallet already linked |
| `WALLET_PROOF_INVALID` | 400 | Bad wallet signature |
| `DB_ERROR` | 500 | Database error (sanitized) |
| `SERVER_MISCONFIGURED` | 500 | Missing env config |
| `RATE_LIMITED` | 429 | Too many requests |
| `LEADER_RATE_LIMIT` | 429 | Leader create limit exceeded |

## Local Development

```bash
# Start Supabase locally
supabase start

# Deploy functions
supabase functions deploy

# Test endpoint
curl -X POST http://localhost:54321/functions/v1/auth-telegram \
  -H "Content-Type: application/json" \
  -d '{"initData": "..."}'
```
