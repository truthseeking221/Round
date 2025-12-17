import { getCorsHeaders, errorResponse, jsonResponse, withCors } from "../_shared/http.ts";
import { createServiceClient } from "../_shared/supabase.ts";

type CircleRow = {
  circle_id: string;
  group_chat_id: number;
  name: string | null;
  status: string;
  current_cycle_index: number;
  onchain_due_at: string | null;
  onchain_grace_end_at: string | null;
  onchain_commit_end_at: string | null;
  onchain_reveal_end_at: string | null;
  commit_duration_sec: number;
};

function ms(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

function shouldFire(nowMs: number, targetMs: number, windowMs: number): boolean {
  return nowMs >= targetMs && nowMs < targetMs + windowMs;
}

async function enqueue(params: {
  supabase: ReturnType<typeof createServiceClient>;
  row: CircleRow;
  kind: "due_reminder" | "auction_open" | "reveal_reminder";
  label: string;
  scheduledAtIso: string;
  payload: Record<string, unknown>;
}) {
  const dedupeKey = `${params.row.circle_id}:${params.row.current_cycle_index}:${params.kind}:${params.label}`;
  const ins = await params.supabase.from("notifications_queue").insert({
    target_type: "group",
    group_chat_id: params.row.group_chat_id,
    circle_id: params.row.circle_id,
    cycle_index: params.row.current_cycle_index,
    kind: params.kind,
    payload: params.payload,
    scheduled_at: params.scheduledAtIso,
    status: "pending",
    dedupe_key: dedupeKey,
  });

  // Idempotent: ignore duplicates
  if (ins.error && !String(ins.error.message).includes("duplicate key value")) {
    throw ins.error;
  }
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

  const supabase = createServiceClient();

  const circlesRes = await supabase
    .from("circles")
    .select(
      "circle_id,group_chat_id,name,status,current_cycle_index,onchain_due_at,onchain_grace_end_at,onchain_commit_end_at,onchain_reveal_end_at,commit_duration_sec"
    )
    .in("status", ["Locked", "Active"]);
  if (circlesRes.error) return errorResponse("DB_ERROR", 500, circlesRes.error.message, origin);

  const nowMs = Date.now();
  const windowMs = 60_000;

  const fired: { circle_id: string; label: string }[] = [];

  for (const row of (circlesRes.data ?? []) as CircleRow[]) {
    const dueMs = ms(row.onchain_due_at);
    const graceEndMs = ms(row.onchain_grace_end_at);
    const commitEndMs = ms(row.onchain_commit_end_at);
    const revealEndMs = ms(row.onchain_reveal_end_at);

    if (dueMs && graceEndMs) {
      const dueT24h = dueMs - 24 * 60 * 60 * 1000;
      const dueT2h = dueMs - 2 * 60 * 60 * 1000;
      const graceHalf = dueMs + Math.floor((graceEndMs - dueMs) / 2);

      const basePayload = {
        circle_id: row.circle_id,
        circle_name: row.name,
        due_at: row.onchain_due_at,
        grace_end_at: row.onchain_grace_end_at,
      };

      if (shouldFire(nowMs, dueT24h, windowMs)) {
        await enqueue({
          supabase,
          row,
          kind: "due_reminder",
          label: "due_t24h",
          scheduledAtIso: new Date(dueT24h).toISOString(),
          payload: { ...basePayload, stage: "T-24h" },
        });
        fired.push({ circle_id: row.circle_id, label: "due_t24h" });
      }
      if (shouldFire(nowMs, dueT2h, windowMs)) {
        await enqueue({
          supabase,
          row,
          kind: "due_reminder",
          label: "due_t2h",
          scheduledAtIso: new Date(dueT2h).toISOString(),
          payload: { ...basePayload, stage: "T-2h" },
        });
        fired.push({ circle_id: row.circle_id, label: "due_t2h" });
      }
      if (shouldFire(nowMs, dueMs, windowMs)) {
        await enqueue({
          supabase,
          row,
          kind: "due_reminder",
          label: "due_now",
          scheduledAtIso: new Date(dueMs).toISOString(),
          payload: { ...basePayload, stage: "due_now" },
        });
        fired.push({ circle_id: row.circle_id, label: "due_now" });
      }
      if (shouldFire(nowMs, graceHalf, windowMs)) {
        await enqueue({
          supabase,
          row,
          kind: "due_reminder",
          label: "grace_half",
          scheduledAtIso: new Date(graceHalf).toISOString(),
          payload: { ...basePayload, stage: "grace_half" },
        });
        fired.push({ circle_id: row.circle_id, label: "grace_half" });
      }
      if (shouldFire(nowMs, graceEndMs, windowMs)) {
        await enqueue({
          supabase,
          row,
          kind: "due_reminder",
          label: "grace_end",
          scheduledAtIso: new Date(graceEndMs).toISOString(),
          payload: { ...basePayload, stage: "grace_end" },
        });
        fired.push({ circle_id: row.circle_id, label: "grace_end" });
      }
    }

    // Auction windows (best-effort, derived)
    if (commitEndMs && Number.isFinite(row.commit_duration_sec)) {
      const commitStartMs = commitEndMs - row.commit_duration_sec * 1000;
      const commitT10m = commitEndMs - 10 * 60 * 1000;
      const commitT2m = commitEndMs - 2 * 60 * 1000;

      const basePayload = {
        circle_id: row.circle_id,
        circle_name: row.name,
        commit_end_at: row.onchain_commit_end_at,
        reveal_end_at: row.onchain_reveal_end_at,
      };

      if (shouldFire(nowMs, commitStartMs, windowMs)) {
        await enqueue({
          supabase,
          row,
          kind: "auction_open",
          label: "commit_open",
          scheduledAtIso: new Date(commitStartMs).toISOString(),
          payload: { ...basePayload, stage: "commit_open" },
        });
        fired.push({ circle_id: row.circle_id, label: "commit_open" });
      }
      if (shouldFire(nowMs, commitT10m, windowMs)) {
        await enqueue({
          supabase,
          row,
          kind: "auction_open",
          label: "commit_t10m",
          scheduledAtIso: new Date(commitT10m).toISOString(),
          payload: { ...basePayload, stage: "commit_t10m" },
        });
        fired.push({ circle_id: row.circle_id, label: "commit_t10m" });
      }
      if (shouldFire(nowMs, commitT2m, windowMs)) {
        await enqueue({
          supabase,
          row,
          kind: "auction_open",
          label: "commit_t2m",
          scheduledAtIso: new Date(commitT2m).toISOString(),
          payload: { ...basePayload, stage: "commit_t2m" },
        });
        fired.push({ circle_id: row.circle_id, label: "commit_t2m" });
      }
    }

    if (revealEndMs) {
      const revealT10m = revealEndMs - 10 * 60 * 1000;
      const revealT2m = revealEndMs - 2 * 60 * 1000;
      const basePayload = {
        circle_id: row.circle_id,
        circle_name: row.name,
        reveal_end_at: row.onchain_reveal_end_at,
      };

      if (shouldFire(nowMs, revealT10m, windowMs)) {
        await enqueue({
          supabase,
          row,
          kind: "reveal_reminder",
          label: "reveal_t10m",
          scheduledAtIso: new Date(revealT10m).toISOString(),
          payload: { ...basePayload, stage: "reveal_t10m" },
        });
        fired.push({ circle_id: row.circle_id, label: "reveal_t10m" });
      }
      if (shouldFire(nowMs, revealT2m, windowMs)) {
        await enqueue({
          supabase,
          row,
          kind: "reveal_reminder",
          label: "reveal_t2m",
          scheduledAtIso: new Date(revealT2m).toISOString(),
          payload: { ...basePayload, stage: "reveal_t2m" },
        });
        fired.push({ circle_id: row.circle_id, label: "reveal_t2m" });
      }
    }
  }

  return jsonResponse({ ok: true, fired }, 200, origin);
});
