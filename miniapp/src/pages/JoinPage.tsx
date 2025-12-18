import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import type { ApiError, CircleStatusResponse } from "../lib/api";
import { getCircleStatus, joinCircle } from "../lib/api";
import { useAuth } from "../auth/useAuth";
import { useSmartWallet } from "../hooks/useSmartWallet"; // Replaced
import { Page } from "../components/layout/Page";
import { Button } from "../components/ui/Button";
import { Card, CardContent } from "../components/ui/Card";
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

  useEffect(() => {
    if (auth.status !== "ready") return;
    setLoading(true);
    getCircleStatus(auth.token, circleId)
      .then(setData)
      .catch(e => setError({ code: "API", message: e.message }))
      .finally(() => setLoading(false));
  }, [auth.status, circleId, auth.token]);

  const handleJoin = async () => {
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
    } catch (e: any) {
      setError({ code: "JOIN_FAILED", message: e.message });
    } finally {
      setBusy(false);
    }
  };

  const circle = data?.circle;

  return (
    <Page title="Join Circle">
      <div className="space-y-6 relative z-10">
        <FundsBanner />
        
        <Link to="/" className="text-sm text-slate-400 hover:text-slate-100 flex items-center gap-1 w-fit">
           <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
            <path fillRule="evenodd" d="M17 10a.75.75 0 01-.75.75H5.612l4.158 3.96a.75.75 0 11-1.04 1.08l-5.5-5.25a.75.75 0 010-1.08l5.5-5.25a.75.75 0 111.04 1.08L5.612 9.25H16.25A.75.75 0 0117 10z" clipRule="evenodd" />
          </svg>
          Decline & Back
        </Link>

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
                             Please connect your wallet (or use Mock Mode) to accept this invitation.
                          </div>
                       ) : (
                          <Button 
                            onClick={handleJoin} 
                            loading={busy} 
                            disabled={busy} 
                            size="lg" 
                            className="w-full text-lg h-14 shadow-xl shadow-blue-500/20"
                          >
                            Sign & Join Circle
                          </Button>
                       )}
                       
                       {error && (
                         <div className="text-red-400 text-sm bg-red-950/20 p-2 rounded">{error.message}</div>
                       )}

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