import { useMemo, useState } from "react";

import { useAuth } from "./useAuth";
import { describeError } from "../lib/errors";
import { Page, LoadingState } from "../components/layout/Page";
import { AlertCard, Card, CardContent, CardHeader, CardTitle } from "../components/ui/Card";
import { Textarea } from "../components/ui/Input";
import { Button } from "../components/ui/Button";

export function AuthGate(props: { children: React.ReactNode }) {
  const auth = useAuth();
  const [manualInitData, setManualInitData] = useState<string>("");

  const showDevInit = useMemo(() => {
    return auth.status === "error" && auth.error.code === "TG_INITDATA_MISSING";
  }, [auth.status, auth.error]);

  if (auth.status === "loading") {
    return (
      <Page title="MoneyCircle" subtitle="Secure rotating savings on TON" showHeader={false} maxWidth="md">
        <div className="pt-6">
          <LoadingState message="Authenticating…" />
        </div>
      </Page>
    );
  }

  if (auth.status === "error") {
    const human = describeError(auth.error);

    return (
      <Page title="Authentication" subtitle="Connect via Telegram to continue" showHeader={false} maxWidth="md">
        <div className="space-y-4 pt-4">
          <AlertCard variant="error" title={human.title}>
            {human.description}
            <div className="mt-2 text-xs text-slate-500">Code: {auth.error.code}</div>
          </AlertCard>

          {showDevInit ? (
            <Card className="border-slate-800/60 bg-slate-900/50">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Local development</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="text-sm text-slate-300">
                  Paste Telegram WebApp <span className="font-mono">initData</span> to authenticate, or set{" "}
                  <span className="font-mono">VITE_DEV_INIT_DATA</span>.
                </div>
                <Textarea
                  rows={5}
                  value={manualInitData}
                  onChange={(e) => setManualInitData(e.target.value)}
                  placeholder="query_id=...&user=...&auth_date=...&hash=..."
                  className="font-mono text-xs"
                />
                <div className="flex gap-2">
                  <Button
                    className="flex-1"
                    onClick={() => {
                      auth.setDevInitData(manualInitData);
                      void auth.refresh();
                    }}
                    disabled={manualInitData.trim().length === 0}
                  >
                    Authenticate
                  </Button>
                  <Button variant="secondary" onClick={() => void auth.refresh()}>
                    Retry
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Button onClick={() => void auth.refresh()} className="w-full">
              Retry
            </Button>
          )}
        </div>
      </Page>
    );
  }

  return <>{props.children}</>;
}
