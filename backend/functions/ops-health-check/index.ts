import { getCorsHeaders, errorResponse, jsonResponse, withCors } from "../_shared/http.ts";
import { createServiceClient } from "../_shared/supabase.ts";

type CircleRow = {
  circle_id: string;
  name: string | null;
  status: string;
  contract_address: string | null;
  last_indexed_at: string | null;
  last_indexer_error: string | null;
};

function ms(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

async function enqueueOpsAlert(params: {
  supabase: ReturnType<typeof createServiceClient>;
  adminTelegramUserId: number;
  circle: CircleRow;
  kind: "INDEXER_LAG" | "INDEXER_ERROR";
  lagSeconds?: number;
}) {
  const bucket = Math.floor(Date.now() / (15 * 60 * 1000)); // 15m bucket to avoid spam
  const dedupeKey = `ops:${params.kind}:${params.circle.circle_id}:${bucket}`;

  const payload: Record<string, unknown> = {
    alert: params.kind,
    circle_id: params.circle.circle_id,
    circle_name: params.circle.name,
    status: params.circle.status,
    contract_address: params.circle.contract_address,
    last_indexed_at: params.circle.last_indexed_at,
    last_indexer_error: params.circle.last_indexer_error,
    lag_seconds: params.lagSeconds ?? null,
  };

  const ins = await params.supabase.from("notifications_queue").insert({
    target_type: "dm",
    telegram_user_id: params.adminTelegramUserId,
    circle_id: params.circle.circle_id,
    kind: "ops_alert",
    payload,
    scheduled_at: new Date().toISOString(),
    status: "pending",
    dedupe_key: dedupeKey,
  });

  // Idempotent: ignore duplicates.
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

  const admin = Deno.env.get("OPS_ADMIN_TELEGRAM_USER_ID");
  if (!admin) {
    // Optional feature: do nothing when not configured.
    return jsonResponse({ ok: true, configured: false }, 200, origin);
  }
  const adminId = Number(admin);
  if (!Number.isFinite(adminId) || adminId <= 0) {
    return errorResponse("SERVER_MISCONFIGURED", 500, "OPS_ADMIN_TELEGRAM_USER_ID must be a number", origin);
  }

  const supabase = createServiceClient();

  const circlesRes = await supabase
    .from("circles")
    .select("circle_id,name,status,contract_address,last_indexed_at,last_indexer_error")
    .not("contract_address", "is", null)
    .in("status", ["Recruiting", "Locked", "Active", "EmergencyStop"]);

  if (circlesRes.error) return errorResponse("DB_ERROR", 500, circlesRes.error.message, origin);

  const thresholdSec = Number(Deno.env.get("INDEXER_LAG_THRESHOLD_SECONDS") ?? "300");
  const thresholdMs = Math.max(60_000, thresholdSec * 1000); // floor at 1 min

  const nowMs = Date.now();
  const alerted: { circle_id: string; kind: string }[] = [];

  for (const c of (circlesRes.data ?? []) as CircleRow[]) {
    const lastMs = ms(c.last_indexed_at);
    const lagMs = lastMs ? nowMs - lastMs : Number.POSITIVE_INFINITY;
    const lagSeconds = Number.isFinite(lagMs) ? Math.floor(lagMs / 1000) : null;

    if (lagMs >= thresholdMs) {
      await enqueueOpsAlert({
        supabase,
        adminTelegramUserId: adminId,
        circle: c,
        kind: "INDEXER_LAG",
        lagSeconds: lagSeconds ?? undefined,
      });
      alerted.push({ circle_id: c.circle_id, kind: "INDEXER_LAG" });
      continue;
    }

    // Also surface persistent indexer errors even if lag isn't crossed.
    if (c.last_indexer_error) {
      await enqueueOpsAlert({
        supabase,
        adminTelegramUserId: adminId,
        circle: c,
        kind: "INDEXER_ERROR",
      });
      alerted.push({ circle_id: c.circle_id, kind: "INDEXER_ERROR" });
    }
  }

  return jsonResponse({ ok: true, configured: true, alerted }, 200, origin);
});

