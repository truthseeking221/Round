import { TonConnectButton } from "@tonconnect/ui-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";

import type { ApiError, CircleStatusResponse } from "../lib/api";
import { getCircleStatus } from "../lib/api";
import { useAuth } from "../auth/useAuth";
import { buildCommitBidPayload, buildRevealBidPayload, clearStoredBidData, getStoredBidData, toNano } from "../lib/tonPayloads";
import { useSmartWallet } from "../hooks/useSmartWallet"; // Replaced
import { cn } from "../lib/cn";
import { Page } from "../components/layout/Page";
import { FundsBanner } from "../components/mc/FundsBanner";
import { IndexerLagBanner } from "../components/mc/IndexerLagBanner";
import { OnChainScheduleCard } from "../components/mc/OnChainScheduleCard";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { AlertCard, Card, CardContent, CardHeader, CardTitle } from "../components/ui/Card";

export function AuctionPage() {
  const auth = useAuth();
  const params = useParams();
  const circleId = String(params.circleId ?? "");
  
  const { sendTransaction, address: walletAddress } = useSmartWallet(); // Use Smart Wallet

  const [data, setData] = useState<CircleStatusResponse | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [nowSec, setNowSec] = useState<number>(() => Math.floor(Date.now() / 1000));

  const [bidAmount, setBidAmount] = useState("");
  const [salt, setSalt] = useState("");

  const refresh = useCallback(async () => {
    if (auth.status !== "ready") return;
    const token = auth.token;
    setLoading(true);
    try {
      const res = await getCircleStatus(token, circleId);
      setData(res);
      setError(null);
    } catch (e: unknown) {
      const maybe = (e ?? {}) as { message?: unknown };
      setError({ code: "API", message: typeof maybe.message === "string" ? maybe.message : "Failed to load circle status." });
    } finally {
      setLoading(false);
    }
  }, [auth.status, auth.token, circleId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const id = window.setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 1000);
    return () => window.clearInterval(id);
  }, []);

  const circle = data?.circle;
  
  // Phase logic
  const now = nowSec;
  const commitEnd = circle?.onchain_commit_end_at ? Date.parse(circle.onchain_commit_end_at)/1000 : 0;
  const revealEnd = circle?.onchain_reveal_end_at ? Date.parse(circle.onchain_reveal_end_at)/1000 : 0;
  
  const isCommitPhase = now < commitEnd;
  const isRevealPhase = now >= commitEnd && now < revealEnd;

  const contractAddress = circle?.contract_address ?? null;
  const cycleIndex = circle?.current_cycle_index ?? 0;

  const storedBid = getStoredBidData();
  const hasStoredBidForCurrent = Boolean(storedBid && contractAddress && storedBid.contractAddress === contractAddress && storedBid.cycleIndex === cycleIndex);
  const storedBidWalletMatches = Boolean(hasStoredBidForCurrent && walletAddress && storedBid?.walletAddress === walletAddress);

  const backupText = useMemo(() => {
    if (!contractAddress || !walletAddress || !bidAmount || !salt) return "";
    return JSON.stringify(
      {
        kind: "MoneyCircleBidBackup",
        version: 1,
        circle_id: circleId,
        contract_address: contractAddress,
        cycle_index: cycleIndex,
        wallet_address: walletAddress,
        payout_usdt: bidAmount,
        salt,
        created_at: new Date().toISOString(),
      },
      null,
      0
    );
  }, [bidAmount, circleId, contractAddress, cycleIndex, salt, walletAddress]);

  const pushNotice = useCallback((msg: string) => {
    setNotice(msg);
    window.setTimeout(() => setNotice(null), 2500);
  }, []);

  const copyToClipboard = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        pushNotice("Copied to clipboard.");
      } catch {
        pushNotice("Copy failed. Please copy manually.");
      }
    },
    [pushNotice]
  );

  const generateSalt = useCallback(() => {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    const hex = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    setSalt(hex);
    pushNotice("Generated a new salt. Save it for reveal.");
  }, [pushNotice]);

  return (
    <Page
      title="Blind Auction"
      subtitle="Commit → Reveal"
      leading={
        <Link
          to={`/circle/${circleId}`}
          className={cn(
            "inline-flex items-center justify-center h-10 w-10 rounded-xl",
            "border border-slate-800/60 bg-slate-950/40 text-slate-300",
            "hover:bg-slate-900/60 hover:text-slate-100 transition-colors"
          )}
          aria-label="Back to circle"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
      }
      headerAction={
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => void refresh()}
            disabled={loading || !!busy}
            aria-label="Refresh"
            title="Refresh"
          >
            {loading ? (
              <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            ) : (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            )}
          </Button>
          <TonConnectButton className="scale-90 origin-right" />
        </div>
      }
    >
      <div className="space-y-6">
        <FundsBanner />
        <IndexerLagBanner circle={circle ?? null} />

        {circle && <OnChainScheduleCard circle={circle} nowMs={nowSec * 1000} />}

        <Card className="bg-slate-950/40 border-slate-800/60">
          <CardContent className="p-4">
            <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500 mb-2">15-second explanation</div>
            <div className="text-sm text-slate-300 leading-relaxed">
              In each cycle, one member receives the pot. You place a blind bid by entering{" "}
              <span className="text-slate-100 font-medium">how much you want to receive</span>. The person willing to
              receive the least wins the cycle. The difference becomes credits for other members (reduces their next
              payment).
            </div>
          </CardContent>
        </Card>

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
                    <label className="text-xs font-bold uppercase text-slate-400">How much do you want to receive? (USDT)</label>
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
	                    <p className="text-[10px] text-slate-500">
                        Never share this. You must reveal with the same wallet and the same salt.
                      </p>
	                 </div>

                   <div className="rounded-xl border border-slate-800/60 bg-slate-900/30 p-3 space-y-2">
                     <div className="text-xs font-semibold text-slate-200">Backup for reveal</div>
                     <div className="text-[11px] text-slate-400 leading-relaxed">
                       Your salt is never sent to our backend. It will be published on-chain during reveal. Save it now (or copy a
                       backup code) — if you lose it, you may lose collateral.
                     </div>
                     <div className="flex flex-wrap gap-2">
                       <Button
                         type="button"
                         size="sm"
                         variant="secondary"
                         onClick={generateSalt}
                         disabled={!isCommitPhase || !!busy}
                       >
                         Generate salt
                       </Button>
                       <Button
                         type="button"
                         size="sm"
                         variant="secondary"
                         onClick={() => void copyToClipboard(backupText)}
                         disabled={!isCommitPhase || !!busy || !backupText}
                       >
                         Copy reveal code
                       </Button>
                       {hasStoredBidForCurrent ? (
                         <Button
                           type="button"
                           size="sm"
                           variant="ghost"
                           onClick={() => {
                             clearStoredBidData();
                             pushNotice("Cleared saved bid data on this device.");
                           }}
                           disabled={!!busy}
                         >
                           Clear saved
                         </Button>
                       ) : null}
                     </div>
                     <details className="rounded-lg border border-slate-800/60 bg-slate-950/30 px-3 py-2">
                       <summary className="cursor-pointer select-none text-[11px] font-semibold text-slate-300">
                         Show backup text
                       </summary>
                       <div className="mt-2 font-mono text-[11px] text-slate-300 break-all select-text">
                         {backupText || "Fill payout + salt to generate."}
                       </div>
                     </details>
                   </div>
	                 <Button 
	                   disabled={!isCommitPhase || !!busy || !bidAmount || !salt || !walletAddress}
	                   onClick={async () => {
	                      if (auth.status !== "ready") return;
	                      if (!contractAddress || !walletAddress) {
	                        setError({ code: "MISSING_PARAMS", message: "Contract or wallet address not available." });
	                        return;
	                      }
	                      setBusy("Committing…");
	                      try {
	                         // Build commit with FULL domain-separated hash (P0 fix)
	                         const { payload } = await buildCommitBidPayload({
	                           bidAmountUsdt: bidAmount,
	                           saltString: salt,
	                           contractAddress,
	                           cycleIndex,
	                           walletAddress,
	                         });
	                         await sendTransaction({
	                           validUntil: Math.floor(Date.now()/1000)+300,
	                           messages: [{ address: contractAddress, amount: toNano("0.05"), payload }]
	                         });
                           pushNotice("Commit sent. Keep your salt for reveal.");
	                         void refresh();
	                      } catch (e: unknown) {
	                        const maybe = (e ?? {}) as { message?: unknown };
	                        setError({ code: "TX", message: typeof maybe.message === "string" ? maybe.message : "Transaction failed." });
	                      }
	                      finally { setBusy(null); }
                   }}
                 >
                   Commit (On-chain)
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
                    <label className="text-xs font-bold uppercase text-slate-400">Re-enter payout (USDT)</label>
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
                   {hasStoredBidForCurrent ? (
                     <div className="rounded-xl border border-slate-800/60 bg-slate-900/30 p-3">
                       <div className="text-[11px] font-semibold text-slate-200">Saved bid found on this device</div>
                       <div className="mt-1 text-[11px] text-slate-400">
                         Reveal must use the same wallet as commit.
                         {!storedBidWalletMatches ? (
                           <span className="text-amber-300"> Current wallet does not match saved commit wallet.</span>
                         ) : null}
                       </div>
                     </div>
                   ) : null}
	                 <Button 
	                   variant="success"
	                   disabled={!isRevealPhase || !!busy || (!hasStoredBidForCurrent && (!bidAmount || !salt)) || (hasStoredBidForCurrent && !storedBidWalletMatches)}
	                   onClick={async () => {
	                      if (auth.status !== "ready") return;
	                      if (!contractAddress || !walletAddress) {
	                        setError({ code: "MISSING_PARAMS", message: "Contract or wallet address not available." });
	                        return;
	                      }
	                      setBusy("Revealing…");
	                      try {
	                         // Try to use stored bid data first (most reliable)
	                         // If not available, use form inputs
	                         let payload: string;
	                         if (hasStoredBidForCurrent) {
                           if (!storedBidWalletMatches) {
                             setError({ code: "WALLET_MISMATCH", message: "Switch to the wallet used for commit, then retry reveal." });
                             return;
                           }
	                           // Use stored data - most reliable
	                           const result = await buildRevealBidPayload({ fromStorage: true });
	                           payload = result.payload;
	                         } else if (bidAmount && salt) {
	                           // Fallback to form inputs - user must re-enter exact values
	                           const result = await buildRevealBidPayload({
	                             bidAmountUsdt: bidAmount,
	                             saltString: salt,
	                             contractAddress,
	                             cycleIndex,
	                             walletAddress,
	                           });
	                           payload = result.payload;
	                         } else {
	                           setError({ code: "MISSING_BID_DATA", message: "Missing bid data. Re-enter your bid amount and salt (from your backup)." });
                           return;
	                         }
                         
	                         await sendTransaction({
	                           validUntil: Math.floor(Date.now()/1000)+300,
	                           messages: [{ address: contractAddress, amount: toNano("0.05"), payload }]
	                         });
                         pushNotice("Reveal sent. Wait 15–60s, then tap Refresh.");
	                         void refresh();
	                      } catch (e: unknown) {
	                        const maybe = (e ?? {}) as { message?: unknown };
	                        setError({ code: "TX", message: typeof maybe.message === "string" ? maybe.message : "Transaction failed." });
	                      }
                      finally { setBusy(null); }
                   }}
                 >
                   Reveal (On-chain)
                 </Button>
              </CardContent>
           </Card>
        </div>

        {error ? (
          <AlertCard variant="error" title="Action failed">
            {error.message}
          </AlertCard>
        ) : null}
        {notice ? (
          <div className="text-center text-slate-300 text-sm">{notice}</div>
        ) : null}
        {busy ? (
          <div className="text-center text-blue-400 animate-pulse">{busy}</div>
        ) : null}
      </div>
    </Page>
  );
}
