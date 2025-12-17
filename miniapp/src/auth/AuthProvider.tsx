import { useCallback, useEffect, useMemo, useState } from "react";

import type { ApiError } from "../lib/api";
import { authTelegram } from "../lib/api";
import { env } from "../lib/env";
import { getTelegramInitData, initTelegramUi } from "../lib/telegram";
import { AuthContext, type AuthContextValue, type AuthState } from "./authContext";

function asApiError(e: unknown): ApiError {
  const maybe = (e ?? {}) as { code?: unknown; message?: unknown };
  return {
    code: typeof maybe.code === "string" && maybe.code.length > 0 ? maybe.code : "API_ERROR",
    message: typeof maybe.message === "string" && maybe.message.length > 0 ? maybe.message : undefined
  };
}

export function AuthProvider(props: { children: React.ReactNode }) {
  const [devInitData, setDevInitData] = useState<string>(() => env.DEV_INIT_DATA);
  const [state, setState] = useState<AuthState>({ status: "loading", token: null, user: null, group: null, error: null });

  useEffect(() => {
    initTelegramUi();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const telegramInitData = getTelegramInitData();
    const initData = (telegramInitData && telegramInitData.trim()) || (env.DEV_INIT_DATA.trim() || null);

    if (!initData) {
      Promise.resolve().then(() => {
        if (cancelled) return;
        setState({
          status: "error",
          token: null,
          user: null,
          group: null,
          error: { code: "TG_INITDATA_MISSING", message: "Open inside Telegram. For local dev, set VITE_DEV_INIT_DATA." }
        });
      });
      return () => {
        cancelled = true;
      };
    }

    authTelegram(initData)
      .then((res) => {
        if (cancelled) return;
        setState({ status: "ready", token: res.session_token, user: res.user, group: res.group, error: null });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setState({ status: "error", token: null, user: null, group: null, error: asApiError(e) });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const refresh = useCallback(async () => {
    setState({ status: "loading", token: null, user: null, group: null, error: null });

    const telegramInitData = getTelegramInitData();
    const initData = (telegramInitData && telegramInitData.trim()) || (devInitData.trim() || null);
    if (!initData) {
      setState({
        status: "error",
        token: null,
        user: null,
        group: null,
        error: { code: "TG_INITDATA_MISSING", message: "Open inside Telegram. For local dev, set VITE_DEV_INIT_DATA." }
      });
      return;
    }

    try {
      const res = await authTelegram(initData);
      setState({ status: "ready", token: res.session_token, user: res.user, group: res.group, error: null });
    } catch (e: unknown) {
      setState({ status: "error", token: null, user: null, group: null, error: asApiError(e) });
    }
  }, [devInitData]);

  const value = useMemo<AuthContextValue>(() => ({ ...state, devInitData, setDevInitData, refresh }), [state, devInitData, refresh]);

  return <AuthContext.Provider value={value}>{props.children}</AuthContext.Provider>;
}
