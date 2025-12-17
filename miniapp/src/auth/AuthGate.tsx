import { useMemo, useState } from "react";

import { useAuth } from "./useAuth";

function ErrorPanel(props: { code: string; message?: string }) {
  return (
    <div style={{ border: "1px solid rgba(255,255,255,0.2)", padding: 12, borderRadius: 12, textAlign: "left" }}>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>Error: {props.code}</div>
      {props.message ? <div style={{ opacity: 0.9 }}>{props.message}</div> : null}
    </div>
  );
}

export function AuthGate(props: { children: React.ReactNode }) {
  const auth = useAuth();
  const [manualInitData, setManualInitData] = useState<string>("");

  const showDevInit = useMemo(() => {
    return auth.status === "error" && auth.error.code === "TG_INITDATA_MISSING";
  }, [auth.status, auth.error]);

  if (auth.status === "loading") {
    return <div style={{ padding: 16, textAlign: "left" }}>Loading…</div>;
  }

  if (auth.status === "error") {
    return (
      <div style={{ padding: 16, textAlign: "left", display: "grid", gap: 12 }}>
        <ErrorPanel code={auth.error.code} message={auth.error.message} />

        {showDevInit ? (
          <div style={{ display: "grid", gap: 8 }}>
            <div style={{ fontWeight: 700 }}>Local dev</div>
            <div style={{ fontSize: 13, opacity: 0.85 }}>
              Paste Telegram WebApp <code>initData</code> to continue, or set <code>VITE_DEV_INIT_DATA</code>.
            </div>
            <textarea
              rows={4}
              value={manualInitData}
              onChange={(e) => setManualInitData(e.target.value)}
              placeholder="query_id=...&user=...&auth_date=...&hash=..."
              style={{ width: "100%", padding: 10, borderRadius: 10 }}
            />
            <button
              onClick={() => {
                auth.setDevInitData(manualInitData);
                void auth.refresh();
              }}
            >
              Authenticate
            </button>
          </div>
        ) : (
          <button onClick={() => void auth.refresh()}>Retry</button>
        )}
      </div>
    );
  }

  return <>{props.children}</>;
}
