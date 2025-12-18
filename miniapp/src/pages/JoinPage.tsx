import { TonConnectButton } from "@tonconnect/ui-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import type { ApiError, CircleStatusResponse } from "../lib/api";
import { getCircleStatus, joinCircle } from "../lib/api";
import { useAuth } from "../auth/useAuth";
import { useSmartWallet } from "../hooks/useSmartWallet"; // Replaced
import { Page } from "../components/layout/Page";
import { Button } from "../components/ui/Button";
import { AlertCard, Card, CardContent } from "../components/ui/Card";
import { formatUsdt } from "../lib/usdt";
import { FundsBanner } from "../components/mc/FundsBanner";

export function JoinPage() {
  const auth = useAuth();
  const params = useParams();
  const navigate = useNavigate();
  const circleId = String(params.circleId ?? "");
  const { wallet, connected } = useSmartWallet(); // Use Smart Wallet

  const [data, setData] = useState<CircleStatusResponse | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<boolean>(false);
  const [accepted, setAccepted] = useState<boolean>(false);

  useEffect(() => {
    if (auth.status !== "ready") return;
    setLoading(true);
    const token = auth.token;
    getCircleStatus(token, circleId)
      .then(setData)
      .catch(e => setError({ code: "API", message: e.message }))
      .finally(() => setLoading(false));
  }, [auth.status, circleId, auth.token]);

  const handleJoin = async () => {
    if (auth.status !== "ready") return;
    if (!wallet) return; // Should handle not connected state UI
    setBusy(true);
    try {
      await joinCircle(auth.token, circleId); // Simplified API call signature based on actual usage, or passing body
      // Actually checking api.ts: joinCircle takes (token, circleId). It uses wallet from token? No, user context.
      // Wait, api.ts joinCircle implementation:
      // export async function joinCircle(token: string, circleId: string): Promise<JoinCircleResponse> {
      //   return await apiFetch<JoinCircleResponse>("circles-join", { method: "POST", token, body: { circle_id: circleId } });
      // }
      // It doesn't take wallet address in body. Backend likely infers from somewhere or just marks intent.
      // But wait, mockApi.ts expected wallet_address in request?
      // "joinCircle: async (req: JoinCircleRequest)" -> mockApi definition
      // Real API definition: "joinCircle(token, circleId)"
      // Let's stick to Real API signature in the UI code.
      
      navigate(`/circle/${circleId}`);
    } catch (e: unknown) {
      const maybe = (e ?? {}) as { message?: unknown };
      setError({ code: "JOIN_FAILED", message: typeof maybe.message === "string" ? maybe.message : "Join failed." });
    } finally {
      setBusy(false);
    }
  };

  const circle = data?.circle;

  return (
    <Page
      title="Join Circle"
      subtitle={circle?.name ?? "Invitation"}
      leading={
        <Link
          to={`/circle/${circleId}`}
          className="inline-flex items-center justify-center h-10 w-10 rounded-xl border border-slate-800/60 bg-slate-950/40 text-slate-300 hover:bg-slate-900/60 hover:text-slate-100 transition-colors"
          aria-label="Back to circle"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
      }
      headerAction={<TonConnectButton className="scale-90 origin-right" />}
    >
      <div className="space-y-6 relative z-10">
        <FundsBanner />

        {loading && <div className="text-center py-12 text-slate-500 animate-pulse">Fetching Invitation...</div>}
        
        {circle && (
           <div className="relative">
              <div className="absolute inset-0 bg-gradient-to-b from-blue-600/20 to-transparent blur-3xl -z-10" />
              
              <Card className="border-t-4 border-t-blue-500 shadow-2xl shadow-blue-900/40">
                 <CardContent className="pt-8 pb-8 px-6 text-center space-y-6">
                    <div>
                       <div className="text-xs font-bold text-blue-400 uppercase tracking-widest mb-2">Invitation to Join</div>
                       <h1 className="text-3xl font-display font-bold text-white mb-1">{circle.name}</h1>
                       <div className="text-slate-400 text-sm">Circle ID: {circle.circle_id}</div>
                    </div>

                    <div className="py-6 border-y border-slate-800 grid grid-cols-2 gap-6">
                       <div className="text-center">
                          <div className="text-xs text-slate-500 uppercase tracking-wide mb-1">Contribution</div>
                          <div className="text-xl font-mono font-bold text-emerald-400">{formatUsdt(BigInt(circle.contribution_units))} USDT</div>
                       </div>
                       <div className="text-center">
                          <div className="text-xs text-slate-500 uppercase tracking-wide mb-1">Cycle</div>
                          <div className="text-xl font-mono font-bold text-slate-200">Monthly</div>
                       </div>
                       <div className="text-center col-span-2">
                          <div className="text-xs text-slate-500 uppercase tracking-wide mb-1">Members</div>
                          <div className="text-lg font-mono font-bold text-slate-200">{circle.n_members} Slots</div>
                       </div>
                    </div>

                    <div className="space-y-4">
                       {!connected ? (
                          <div className="p-4 bg-slate-900 rounded-xl border border-dashed border-slate-700 text-slate-400 text-sm">
                             Connect your wallet to accept this invitation.
                          </div>
                       ) : (
                          <Button 
                            onClick={handleJoin} 
                            loading={busy} 
                            disabled={busy || !accepted} 
                            size="lg" 
                            className="w-full text-lg h-14 shadow-xl shadow-blue-500/20"
                          >
                            Join Circle
                          </Button>
                       )}

                       <label className="flex items-start gap-2 text-sm text-slate-300 text-left">
                         <input
                           type="checkbox"
                           className="mt-0.5 accent-blue-500"
                           checked={accepted}
                           onChange={(e) => setAccepted(e.target.checked)}
                         />
                         <span>I understand and accept the rules.</span>
                       </label>

                       <div className="rounded-xl bg-slate-950/40 border border-slate-800/60 p-4 text-left">
                         <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500 mb-2">
                           15-second explanation
                         </div>
                         <div className="text-sm text-slate-300 leading-relaxed">
                           In each cycle, one member receives the pot. You place a blind bid by entering{" "}
                           <span className="text-slate-100 font-medium">how much you want to receive</span>. The person
                           willing to receive the least wins the cycle. The difference becomes credits for other members
                           (reduces their next payment).
                         </div>
                       </div>
                       
                       {error ? (
                         <AlertCard variant="error" title="Join failed">
                           {error.message}
                         </AlertCard>
                       ) : null}

                       <p className="text-xs text-slate-500 px-4">
                         By joining, you agree to the smart contract rules. You must deposit collateral before the circle starts.
                       </p>
                    </div>
                 </CardContent>
              </Card>
           </div>
        )}
      </div>
    </Page>
  );
}
