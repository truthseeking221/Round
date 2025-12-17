import { useAuth } from "./useAuth";

export function useSessionToken(): string {
  const auth = useAuth();
  if (auth.status !== "ready") throw new Error("AUTH_NOT_READY");
  return auth.token;
}
