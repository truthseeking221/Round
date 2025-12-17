type SessionRow = {
  telegram_user_id: number;
  group_chat_id: number | null;
  expires_at: string;
};

export async function requireSession(params: {
  req: Request;
  supabase: any;
}): Promise<SessionRow> {
  const authHeader = params.req.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) {
    throw new Error("AUTH_REQUIRED");
  }

  const nowIso = new Date().toISOString();
  const res = await params.supabase
    .from("sessions")
    .select("telegram_user_id, group_chat_id, expires_at")
    .eq("session_token", token)
    .gte("expires_at", nowIso)
    .single();

  if (res.error || !res.data) {
    throw new Error("AUTH_INVALID");
  }
  return res.data as SessionRow;
}

