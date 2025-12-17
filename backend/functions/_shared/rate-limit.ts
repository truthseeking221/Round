import { errorResponse } from "./http.ts";

type SupabaseClient = {
  rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
};

export function getClientIp(req: Request): string | null {
  const cf = req.headers.get("cf-connecting-ip");
  if (cf && cf.trim()) return cf.trim();

  const real = req.headers.get("x-real-ip");
  if (real && real.trim()) return real.trim();

  const xff = req.headers.get("x-forwarded-for");
  if (xff && xff.trim()) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return null;
}

export async function enforceRateLimit(params: {
  supabase: SupabaseClient;
  origin?: string | null;
  action: string;
  key: string;
  limit: number;
  windowSeconds: number;
  errorCode?: string; // default: RATE_LIMITED
}): Promise<Response | null> {
  const code = params.errorCode ?? "RATE_LIMITED";

  try {
    const res = await params.supabase.rpc("check_rate_limit", {
      p_action: params.action,
      p_key: params.key,
      p_limit: params.limit,
      p_window_seconds: params.windowSeconds,
    });

    if (res.error) {
      console.error("[RATE_LIMIT_RPC_ERROR]", res.error.message);
      return null; // fail open
    }

    const row = Array.isArray(res.data) ? res.data[0] : res.data;
    const allowed = Boolean((row as any)?.allowed ?? true);
    const resetAt = (row as any)?.reset_at ? String((row as any).reset_at) : null;

    if (allowed) return null;

    let retryAfterSeconds: number | null = null;
    if (resetAt) {
      const ms = Date.parse(resetAt);
      if (Number.isFinite(ms)) retryAfterSeconds = Math.max(1, Math.floor((ms - Date.now()) / 1000));
    }

    const message = retryAfterSeconds ? `Too many requests. Try again in ${retryAfterSeconds}s.` : "Too many requests. Please try again later.";
    return errorResponse(code, 429, message, params.origin);
  } catch (e) {
    console.error("[RATE_LIMIT_ERROR]", e);
    return null; // fail open
  }
}

