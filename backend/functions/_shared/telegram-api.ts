export type TelegramChatMember = {
  status: "creator" | "administrator" | "member" | "restricted" | "left" | "kicked";
};

export type TelegramApiOk<T> = { ok: true; result: T };
export type TelegramApiErr = { ok: false; description?: string; error_code?: number; parameters?: { retry_after?: number } };
export type TelegramApiResponse<T> = TelegramApiOk<T> | TelegramApiErr;

export function getTelegramBotToken(): string {
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (!token) throw new Error("SERVER_MISCONFIGURED");
  return token;
}

async function telegramGet<T>(token: string, method: string, params: Record<string, string | number>): Promise<TelegramApiResponse<T>> {
  const url = new URL(`https://api.telegram.org/bot${token}/${method}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

  const res = await fetch(url.toString(), { method: "GET" });
  const json = (await res.json().catch(() => null)) as TelegramApiResponse<T> | null;
  if (!json || typeof json !== "object") {
    return { ok: false, description: "TG_BAD_RESPONSE", error_code: res.status };
  }
  return json;
}

async function telegramPost<T>(token: string, method: string, body: Record<string, unknown>): Promise<TelegramApiResponse<T>> {
  const url = new URL(`https://api.telegram.org/bot${token}/${method}`);
  const res = await fetch(url.toString(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => null)) as TelegramApiResponse<T> | null;
  if (!json || typeof json !== "object") {
    return { ok: false, description: "TG_BAD_RESPONSE", error_code: res.status };
  }
  return json;
}

export async function getChatMember(params: {
  botToken: string;
  chatId: number;
  userId: number;
}): Promise<TelegramApiResponse<TelegramChatMember>> {
  return await telegramGet<TelegramChatMember>(params.botToken, "getChatMember", {
    chat_id: params.chatId,
    user_id: params.userId
  });
}

export async function getMe(params: { botToken: string }): Promise<TelegramApiResponse<{ id: number; username?: string }>> {
  return await telegramGet<{ id: number; username?: string }>(params.botToken, "getMe", {});
}

export async function sendMessage(params: {
  botToken: string;
  chatId: number;
  text: string;
  disableWebPagePreview?: boolean;
}): Promise<TelegramApiResponse<{ message_id: number }>> {
  return await telegramPost<{ message_id: number }>(params.botToken, "sendMessage", {
    chat_id: params.chatId,
    text: params.text,
    disable_web_page_preview: params.disableWebPagePreview ?? true,
  });
}

export async function editMessageText(params: {
  botToken: string;
  chatId: number;
  messageId: number;
  text: string;
  disableWebPagePreview?: boolean;
}): Promise<TelegramApiResponse<{ message_id: number }>> {
  return await telegramPost<{ message_id: number }>(params.botToken, "editMessageText", {
    chat_id: params.chatId,
    message_id: params.messageId,
    text: params.text,
    disable_web_page_preview: params.disableWebPagePreview ?? true,
  });
}

export async function pinChatMessage(params: {
  botToken: string;
  chatId: number;
  messageId: number;
  disableNotification?: boolean;
}): Promise<TelegramApiResponse<true>> {
  return await telegramPost<true>(params.botToken, "pinChatMessage", {
    chat_id: params.chatId,
    message_id: params.messageId,
    disable_notification: params.disableNotification ?? true,
  });
}
