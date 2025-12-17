import { getCorsHeaders, errorResponse, jsonResponse, withCors } from "../_shared/http.ts";
import { createServiceClient } from "../_shared/supabase.ts";

type TelegramSendMessageOk = { ok: true; result: { message_id: number } };
type TelegramSendMessageErr = { ok: false; error_code?: number; description?: string; parameters?: { retry_after?: number } };

async function sendMessage(params: {
  botToken: string;
  chatId: number;
  text: string;
}): Promise<TelegramSendMessageOk | TelegramSendMessageErr> {
  const url = `https://api.telegram.org/bot${params.botToken}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: params.chatId,
      text: params.text,
      disable_web_page_preview: true,
    }),
  });
  const json = (await res.json().catch(() => null)) as (TelegramSendMessageOk | TelegramSendMessageErr) | null;
  if (!json || typeof json !== "object") {
    return { ok: false, error_code: res.status, description: "TG_BAD_RESPONSE" };
  }
  return json;
}

function renderText(n: { kind: string; payload: Record<string, unknown> }): string {
  const kind = String(n.kind);
  const payload = n.payload ?? {};
  const circleName = payload.circle_name ? ` (${payload.circle_name})` : "";

  if (kind === "due_reminder") {
    const stage = String(payload.stage ?? "due");
    const dueAt = String(payload.due_at ?? "");
    const graceEnd = String(payload.grace_end_at ?? "");
    if (stage === "T-24h") return `MoneyCircle${circleName}: Payment is due in 24h.\nDue: ${dueAt}\nGrace ends: ${graceEnd}`;
    if (stage === "T-2h") return `MoneyCircle${circleName}: Payment is due in 2h.\nDue: ${dueAt}\nGrace ends: ${graceEnd}`;
    if (stage === "due_now") return `MoneyCircle${circleName}: Payment is due now.\nGrace ends: ${graceEnd}`;
    if (stage === "grace_half") return `MoneyCircle${circleName}: Grace period is halfway.\nGrace ends: ${graceEnd}`;
    if (stage === "grace_end")
      return `MoneyCircle${circleName}: Grace period has ended.\nIf not fully funded, the circle may terminate by rules.`;
    return `MoneyCircle${circleName}: Payment reminder.\nDue: ${dueAt}\nGrace ends: ${graceEnd}`;
  }

  if (kind === "auction_open") {
    const stage = String(payload.stage ?? "auction");
    const commitEnd = String(payload.commit_end_at ?? "");
    const revealEnd = String(payload.reveal_end_at ?? "");
    if (stage === "commit_open")
      return `MoneyCircle${circleName}: Auction is open.\nCommit ends: ${commitEnd}\nReveal ends: ${revealEnd}`;
    if (stage === "commit_t10m") return `MoneyCircle${circleName}: Commit ends in 10 minutes.\nCommit ends: ${commitEnd}`;
    if (stage === "commit_t2m") return `MoneyCircle${circleName}: Commit ends in 2 minutes.\nCommit ends: ${commitEnd}`;
    return `MoneyCircle${circleName}: Auction reminder.\nCommit ends: ${commitEnd}\nReveal ends: ${revealEnd}`;
  }

  if (kind === "reveal_reminder") {
    const stage = String(payload.stage ?? "reveal");
    const revealEnd = String(payload.reveal_end_at ?? "");
    if (stage === "reveal_t10m") return `MoneyCircle${circleName}: Reveal ends in 10 minutes.\nReveal ends: ${revealEnd}`;
    if (stage === "reveal_t2m") return `MoneyCircle${circleName}: Reveal ends in 2 minutes.\nReveal ends: ${revealEnd}`;
    return `MoneyCircle${circleName}: Reveal reminder.\nReveal ends: ${revealEnd}`;
  }

  if (kind === "ops_alert") {
    const alert = String(payload.alert ?? "ALERT");
    const circleId = String(payload.circle_id ?? "");
    const status = String(payload.status ?? "");
    const contract = String(payload.contract_address ?? "");
    const last = String(payload.last_indexed_at ?? "");
    const lag = payload.lag_seconds != null ? String(payload.lag_seconds) : "";
    const err = payload.last_indexer_error ? String(payload.last_indexer_error) : "";

    if (alert === "INDEXER_LAG") {
      return [
        `MoneyCircle Ops: Indexer lag detected${circleName}`,
        circleId ? `Circle: ${circleId}` : null,
        status ? `Status: ${status}` : null,
        contract ? `Contract: ${contract}` : null,
        last ? `Last indexed: ${last}` : null,
        lag ? `Lag: ${lag}s` : null,
      ]
        .filter(Boolean)
        .join("\n");
    }

    if (alert === "INDEXER_ERROR") {
      return [
        `MoneyCircle Ops: Indexer error${circleName}`,
        circleId ? `Circle: ${circleId}` : null,
        status ? `Status: ${status}` : null,
        contract ? `Contract: ${contract}` : null,
        err ? `Error: ${err}` : null,
      ]
        .filter(Boolean)
        .join("\n");
    }

    return `MoneyCircle Ops: ${alert}${circleName}`;
  }

  return `MoneyCircle${circleName}: Notification`;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return withCors(new Response(null, { status: 204, headers: getCorsHeaders(origin) }), origin);
  }
  if (req.method !== "POST") {
    return errorResponse("METHOD_NOT_ALLOWED", 405, undefined, origin);
  }

  const expectedSecret = Deno.env.get("INDEXER_CRON_SECRET");
  if (expectedSecret) {
    const got = req.headers.get("x-cron-secret") ?? "";
    if (got !== expectedSecret) {
      return errorResponse("FORBIDDEN", 403, undefined, origin);
    }
  }

  const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (!botToken) return errorResponse("SERVER_MISCONFIGURED", 500, undefined, origin);

  const supabase = createServiceClient();

  const nowIso = new Date().toISOString();
  const q = await supabase
    .from("notifications_queue")
    .select("id,target_type,group_chat_id,telegram_user_id,kind,payload,scheduled_at")
    .eq("status", "pending")
    .lte("scheduled_at", nowIso)
    .order("scheduled_at", { ascending: true })
    .limit(20);

  if (q.error) return errorResponse("DB_ERROR", 500, q.error.message, origin);

  const processed: { id: string; ok: boolean; message_id?: number; error?: string; retry_after?: number }[] = [];

  for (const n of q.data ?? []) {
    const chatId = n.target_type === "dm" ? Number(n.telegram_user_id) : Number(n.group_chat_id);
    if (!Number.isFinite(chatId) || chatId === 0) {
      await supabase.from("notifications_queue").update({ status: "failed", fail_reason: "BAD_TARGET" }).eq("id", n.id);
      processed.push({ id: n.id, ok: false, error: "BAD_TARGET" });
      continue;
    }

    const text = renderText({ kind: n.kind, payload: (n.payload ?? {}) as Record<string, unknown> });
    const res = await sendMessage({ botToken, chatId, text });

    if (res.ok) {
      await supabase.from("notifications_queue").update({ status: "sent" }).eq("id", n.id);
      processed.push({ id: n.id, ok: true, message_id: res.result.message_id });
      continue;
    }

    if (res.error_code === 429 && res.parameters?.retry_after) {
      const retryAfter = Math.max(1, Number(res.parameters.retry_after));
      const nextIso = new Date(Date.now() + retryAfter * 1000).toISOString();
      await supabase
        .from("notifications_queue")
        .update({ scheduled_at: nextIso, fail_reason: `429 retry_after=${retryAfter}` })
        .eq("id", n.id);
      processed.push({ id: n.id, ok: false, error: "429", retry_after: retryAfter });
      continue;
    }

    await supabase
      .from("notifications_queue")
      .update({ status: "failed", fail_reason: res.description ?? "TG_SEND_FAILED" })
      .eq("id", n.id);
    processed.push({ id: n.id, ok: false, error: res.description ?? "TG_SEND_FAILED" });
  }

  return jsonResponse({ ok: true, processed }, 200, origin);
});
