import { getCorsHeaders, errorResponse, jsonResponse, readJson, withCors } from "../_shared/http.ts";
import { requireSession } from "../_shared/auth.ts";
import { enforceRateLimit } from "../_shared/rate-limit.ts";
import { createServiceClient } from "../_shared/supabase.ts";
import { getChatMember, getMe, getTelegramBotToken, pinChatMessage, sendMessage } from "../_shared/telegram-api.ts";
import { parseUsdtToUnits } from "../_shared/usdt.ts";

type CreateCircleRequest = {
  name?: string;
  n_members: number;
  contribution_usdt: string | number;
  interval: "weekly" | "monthly";
};

function requireEnvInt(name: string): bigint {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`MISSING_${name}`);
  if (!/^\d+$/.test(v)) throw new Error(`INVALID_${name}`);
  return BigInt(v);
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return withCors(new Response(null, { status: 204, headers: getCorsHeaders(origin) }), origin);
  }
  if (req.method !== "POST") {
    return errorResponse("METHOD_NOT_ALLOWED", 405, undefined, origin);
  }

  const supabase = createServiceClient();

  let session;
  try {
    session = await requireSession({ req, supabase });
  } catch (e) {
    const code = e instanceof Error ? e.message : "AUTH_INVALID";
    return errorResponse(code, 401, undefined, origin);
  }

  const limited = await enforceRateLimit({
    supabase,
    origin,
    action: "circle_create",
    key: `tg:${session.telegram_user_id}`,
    limit: 5,
    windowSeconds: 7 * 24 * 60 * 60,
    errorCode: "LEADER_RATE_LIMIT",
  });
  if (limited) return limited;

  if (!session.group_chat_id) {
    return errorResponse("TG_GROUP_REQUIRED", 400, "Open the mini app inside a Telegram group", origin);
  }

  let body: CreateCircleRequest;
  try {
    body = await readJson<CreateCircleRequest>(req);
  } catch (e) {
    return errorResponse(e instanceof Error ? e.message : "INVALID_JSON", 400, undefined, origin);
  }

  const n = Number(body?.n_members);
  if (!Number.isFinite(n) || n < 2 || n > 12) {
    return errorResponse("BAD_REQUEST", 400, "n_members must be 2..12", origin);
  }

  let contributionUnits: bigint;
  try {
    contributionUnits = parseUsdtToUnits(body.contribution_usdt);
  } catch {
    return errorResponse("BAD_REQUEST", 400, "invalid contribution_usdt", origin);
  }

  const intervalSec = body.interval === "weekly" ? 7 * 24 * 3600 : 30 * 24 * 3600;

  // MVP fixed params (v1.2.1)
  const graceSec = 24 * 3600;
  const takeRateBps = 100;
  const maxDiscountBps = 500;
  const vestingBpsCycle1 = 2000;
  const earlyLockRateBpsCycle1 = 3000;
  const commitDurationSec = 1800;
  const revealDurationSec = 1800;

  let maxPotCapUnits: bigint;
  let minDepositUnits: bigint;
  try {
    maxPotCapUnits = requireEnvInt("MAX_POT_CAP_UNITS");
    minDepositUnits = requireEnvInt("MIN_DEPOSIT_UNITS");
  } catch (e) {
    return errorResponse("SERVER_MISCONFIGURED", 500, undefined, origin);
  }
  const collateralRateBps = Number(Deno.env.get("COLLATERAL_RATE_BPS") ?? "1000");
  if (!Number.isFinite(collateralRateBps) || collateralRateBps < 0 || collateralRateBps > 10_000) {
    return errorResponse("SERVER_MISCONFIGURED", 500, undefined, origin);
  }

  const pot = BigInt(n) * contributionUnits;
  if (pot > maxPotCapUnits) {
    return errorResponse("CAP_EXCEEDED", 400, undefined, origin);
  }

  // Social anchor: caller must be member of the group
  const botToken = getTelegramBotToken();
  const chatId = Number(session.group_chat_id);
  const userId = Number(session.telegram_user_id);
  const memberRes = await getChatMember({ botToken, chatId, userId });
  if (!memberRes.ok) return errorResponse("TG_NOT_IN_GROUP", 403, undefined, origin);
  if (memberRes.result.status === "kicked") return errorResponse("TG_BANNED", 403, undefined, origin);
  if (memberRes.result.status === "left") return errorResponse("TG_NOT_IN_GROUP", 403, undefined, origin);

  // Ensure bot is in group (best-effort).
  const me = await getMe({ botToken });
  if (!me.ok) return errorResponse("SERVER_MISCONFIGURED", 500, undefined, origin);
  const botMember = await getChatMember({ botToken, chatId, userId: me.result.id });
  if (!botMember.ok || botMember.result.status === "left" || botMember.result.status === "kicked") {
    return errorResponse("BOT_NOT_IN_GROUP", 400, undefined, origin);
  }

  // Upsert group flags best-effort.
  await supabase
    .from("tg_groups")
    .upsert(
      {
        group_chat_id: chatId,
        bot_present: true,
        bot_admin: botMember.result.status === "administrator" || botMember.result.status === "creator",
        last_checked_at: new Date().toISOString(),
      },
      { onConflict: "group_chat_id" }
    );

  const ins = await supabase
    .from("circles")
    .insert({
      group_chat_id: chatId,
      leader_user_id: session.telegram_user_id,
      name: body.name ?? null,
      status: "Recruiting",
      contract_address: null,
      jetton_master: Deno.env.get("USDT_JETTON_MASTER") ?? null,
      n_members: n,
      contribution_units: contributionUnits.toString(),
      total_cycles: n,
      interval_sec: intervalSec,
      grace_sec: graceSec,
      take_rate_bps: takeRateBps,
      collateral_rate_bps: collateralRateBps,
      max_discount_bps: maxDiscountBps,
      vesting_bps_cycle1: vestingBpsCycle1,
      early_lock_rate_bps_cycle1: earlyLockRateBpsCycle1,
      commit_duration_sec: commitDurationSec,
      reveal_duration_sec: revealDurationSec,
      max_pot_cap_units: maxPotCapUnits.toString(),
      min_deposit_units: minDepositUnits.toString(),
    })
    .select()
    .single();

  if (ins.error) {
    return errorResponse("DB_ERROR", 500, ins.error.message, origin);
  }

  // Ensure leader has a membership row (for join flow).
  const insMember = await supabase.from("circle_members").insert({
    circle_id: ins.data.circle_id,
    telegram_user_id: session.telegram_user_id,
    join_status: "joined",
  });
  if (insMember.error) {
    // Best-effort rollback
    await supabase.from("circles").delete().eq("circle_id", ins.data.circle_id);
    return errorResponse("DB_ERROR", 500, insMember.error.message, origin);
  }

  // Best-effort: post a join link to the group and pin it (if possible).
  try {
    const miniappUrl = (Deno.env.get("MINIAPP_PUBLIC_URL") ?? "").trim();
    if (miniappUrl) {
      const joinUrl = `${miniappUrl.replace(/\\/$/, "")}/#/circle/${ins.data.circle_id}`;
      const text = [
        `MoneyCircle: New circle created${ins.data.name ? ` — ${ins.data.name}` : ""}`,
        `Circle ID: ${ins.data.circle_id}`,
        `Members (N): ${ins.data.n_members}`,
        `Contribution per cycle: ${String(body.contribution_usdt)} USDT`,
        `Interval: ${body.interval === "weekly" ? "Weekly" : "Monthly"}`,
        "",
        `Join: ${joinUrl}`,
        "",
        "Notes:",
        "- You must be a member of this Telegram group to join.",
        "- Funds are held by a smart contract; the app cannot move funds outside the rules.",
      ].join("\\n");

      const msg = await sendMessage({ botToken, chatId, text });
      if (msg.ok) {
        const messageId = msg.result.message_id;
        const pin = await pinChatMessage({ botToken, chatId, messageId, disableNotification: true });
        const pinned = pin.ok;

        await supabase.from("bot_messages").upsert(
          {
            group_chat_id: chatId,
            circle_id: ins.data.circle_id,
            message_type: "JoinPost",
            message_id: messageId,
            pinned,
            last_edited_at: new Date().toISOString(),
          },
          { onConflict: "group_chat_id,circle_id,message_type" }
        );
      }
    }
  } catch (e) {
    console.error("[JOIN_POST_FAILED]", e);
  }

  return jsonResponse({ ok: true, circle: ins.data }, 200, origin);
});
