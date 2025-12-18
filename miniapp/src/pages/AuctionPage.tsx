import { TonConnectButton } from "@tonconnect/ui-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";

import type { ApiError, CircleStatusResponse } from "../lib/api";
import { getCircleStatus, publishBid } from "../lib/api";
import { useAuth } from "../auth/useAuth";
import { buildCommitBidPayload, buildRevealBidPayload, toNano } from "../lib/tonPayloads";
import { useSmartWallet } from "../hooks/useSmartWallet"; // Replaced
import { Page } from "../components/layout/Page";
import { FundsBanner } from "../components/mc/FundsBanner";
import { OnChainScheduleCard } from "../components/mc/OnChainScheduleCard";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/Card";

export function AuctionPage() {
  const auth = useAuth();
  const params = useParams();
  const circleId = String(params.circleId ?? "");
  
  const { wallet, sendTransaction } = useSmartWallet(); // Use Smart Wallet

  const [data, setData] = useState<CircleStatusResponse | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const [bidAmount, setBidAmount] = useState("");
  const [salt, setSalt] = useState("");

  const refresh = async () => {
    if (auth.status !== "ready") return;
    setLoading(true);
    try {
      const res = await getCircleStatus(auth.token, circleId);
      setData(res);
    } catch (e: any) {
      setError({ code: "API", message: e.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    const timer = setInterval(() => {
       // Optional: Auto-refresh schedule logic could go here
    }, 5000);
    return () => clearInterval(timer);
  }, [auth.status, circleId]);

  const circle = data?.circle;
  
  // Phase logic
  const now = Date.now() / 1000;
  const commitEnd = circle?.onchain_commit_end_at ? Date.parse(circle.onchain_commit_end_at)/1000 : 0;
  const revealEnd = circle?.onchain_reveal_end_at ? Date.parse(circle.onchain_reveal_end_at)/1000 : 0;
  
  const isCommitPhase = now < commitEnd;
  const isRevealPhase = now >= commitEnd && now < revealEnd;

  return (
    <Page title="Auction Room">
      <div className="space-y-6">
        <FundsBanner />
        
        <div className="flex items-center justify-between">
           <Link to={`/circle/${circleId}`} className="text-sm text-slate-400 hover:text-slate-100 flex items-center gap-1">
             <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
              <path fillRule="evenodd" d="M17 10a.75.75 0 01-.75.75H5.612l4.158 3.96a.75.75 0 11-1.04 1.08l-5.5-5.25a.75.75 0 010-1.08l5.5-5.25a.75.75 0 111.04 1.08L5.612 9.25H16.25A.75.75 0 0117 10z" clipRule="evenodd" />
            </svg>
            Back to Circle
           </Link>
           <TonConnectButton className="scale-90 origin-right" />
        </div>

        {circle && <OnChainScheduleCard circle={circle} />}

        <div className="grid md:grid-cols-2 gap-6">
           {/* Commit Card */}
           <Card className={`relative ${!isCommitPhase ? "opacity-50 grayscale" : "border-blue-500/50 shadow-blue-900/20"}`}>
              {!isCommitPhase && <div className="absolute inset-0 z-10 bg-slate-950/50 backdrop-blur-[1px] rounded-2xl flex items-center justify-center font-bold text-slate-400">PHASE CLOSED</div>}
              <CardHeader>
                 <CardTitle className="text-blue-400">1. Commit Bid</CardTitle>
                 <p className="text-xs text-slate-400">Submit a hidden bid hash to the blockchain.</p>
              </CardHeader>
              <CardContent className="space-y-4">
                 <div className="space-y-2">
                    <label className="text-xs font-bold uppercase text-slate-400">Your Bid (USDT)</label>
                    <Input 
                      placeholder="e.g. 5.5" 
                      value={bidAmount} 
                      onChange={e => setBidAmount(e.target.value)} 
                      disabled={!isCommitPhase}
                      className="font-mono text-lg"
                    />
                 </div>
                 <div className="space-y-2">
                    <label className="text-xs font-bold uppercase text-slate-400">Secret Salt</label>
                    <Input 
                      placeholder="Random secret..." 
                      value={salt} 
                      onChange={e => setSalt(e.target.value)} 
                      disabled={!isCommitPhase}
                      type="password"
                    />
                    <p className="text-[10px] text-slate-500">Keep this secret! You need it to reveal later.</p>
                 </div>
                 <Button 
                   disabled={!isCommitPhase || !!busy || !bidAmount || !salt}
                   onClick={async () => {
                      if(!circle.contract_address) return;
                      setBusy("Committing...");
                      try {
                         await publishBid(auth.token, { circle_id: circleId, bid_amount: bidAmount, salt });
                         const payload = await buildCommitBidPayload(bidAmount, salt);
                         await sendTransaction({
                           validUntil: Math.floor(Date.now()/1000)+300,
                           messages: [{ address: circle.contract_address, amount: toNano("0.05"), payload }]
                         });
                         refresh();
                      } catch(e: any) { setError({code:"TX", message: e.message}); } 
                      finally { setBusy(null); }
                   }}
                 >
                   Commit Bid (On-Chain)
                 </Button>
              </CardContent>
           </Card>

           {/* Reveal Card */}
           <Card className={`relative ${!isRevealPhase ? "opacity-50 grayscale" : "border-emerald-500/50 shadow-emerald-900/20"}`}>
              {!isRevealPhase && <div className="absolute inset-0 z-10 bg-slate-950/50 backdrop-blur-[1px] rounded-2xl flex items-center justify-center font-bold text-slate-400">
                 {now < commitEnd ? "WAIT FOR REVEAL PHASE" : "PHASE CLOSED"}
              </div>}
              <CardHeader>
                 <CardTitle className="text-emerald-400">2. Reveal Bid</CardTitle>
                 <p className="text-xs text-slate-400">Publicly reveal your bid to win the pot.</p>
              </CardHeader>
              <CardContent className="space-y-4">
                 <div className="space-y-2">
                    <label className="text-xs font-bold uppercase text-slate-400">Re-enter Bid</label>
                    <Input 
                      placeholder="Must match commit" 
                      value={bidAmount} 
                      onChange={e => setBidAmount(e.target.value)} 
                      disabled={!isRevealPhase}
                    />
                 </div>
                 <div className="space-y-2">
                    <label className="text-xs font-bold uppercase text-slate-400">Re-enter Salt</label>
                    <Input 
                      placeholder="Must match commit" 
                      value={salt} 
                      onChange={e => setSalt(e.target.value)} 
                      disabled={!isRevealPhase}
                      type="password"
                    />
                 </div>
                 <Button 
                   variant="success"
                   disabled={!isRevealPhase || !!busy || !bidAmount || !salt}
                   onClick={async () => {
                      if(!circle.contract_address) return;
                      setBusy("Revealing...");
                      try {
                         const payload = await buildRevealBidPayload(bidAmount, salt);
                         await sendTransaction({
                           validUntil: Math.floor(Date.now()/1000)+300,
                           messages: [{ address: circle.contract_address, amount: toNano("0.05"), payload }]
                         });
                         refresh();
                      } catch(e: any) { setError({code:"TX", message: e.message}); } 
                      finally { setBusy(null); }
                   }}
                 >
                   Reveal Bid (On-Chain)
                 </Button>
              </CardContent>
           </Card>
        </div>

        {error && <div className="text-red-400 text-center bg-red-950/20 p-2 rounded">{error.message}</div>}
        {busy && <div className="text-center text-blue-400 animate-pulse">{busy}</div>}
      </div>
    </Page>
  );
}