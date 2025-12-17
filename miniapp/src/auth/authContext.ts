import { createContext } from "react";

import type { ApiError, TgGroup, TgUser } from "../lib/api";

export type AuthState =
  | { status: "loading"; token: null; user: null; group: null; error: null }
  | { status: "ready"; token: string; user: TgUser; group: TgGroup | null; error: null }
  | { status: "error"; token: null; user: null; group: null; error: ApiError };

export type AuthContextValue = AuthState & {
  devInitData: string;
  setDevInitData: (initData: string) => void;
  refresh: () => Promise<void>;
};

export const AuthContext = createContext<AuthContextValue | null>(null);

