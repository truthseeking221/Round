import { TonConnectButton } from "@tonconnect/ui-react";
import { Address } from "@ton/core";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";

import type { ApiError, CircleStatusResponse } from "../lib/api";
import { attachContract, depositIntent, getCircleStatus } from "../lib/api";
import { useAuth } from "../auth/useAuth";
import { useSmartWallet } from "../hooks/useSmartWallet"; // Replaced
import { cn } from "../lib/cn";
import { formatUsdt } from "../lib/usdt";
import { Page } from "../components/layout/Page";
import { FundsBanner } from "../components/mc/FundsBanner";
import { IndexerLagBanner } from "../components/mc/IndexerLagBanner";
import { OnChainScheduleCard } from "../components/mc/OnChainScheduleCard";
import { Badge, getStatusBadgeVariant } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { AlertCard, Card, CardContent, CardDescription, CardHeader, CardTitle, StatCard } from "../components/ui/Card";
import {
  buildFinalizeAuctionPayload,
  buildInitJettonWalletPayload,
  buildTerminateDefaultPayload,
  buildTriggerDebitAllPayload,
  toNano
} from "../lib/tonPayloads";
import { describeError } from "../lib/errors";

function displayStatus(status: string): string {
  return status === "EmergencyStop" ? "Emergency Stop" : status;
}

function toBigIntSafe(v: unknown): bigint {
  try {
    if (typeof v === "bigint") return v;
    if (typeof v === "number") return BigInt(v);
    if (typeof v === "string" && v.trim() !== "") return BigInt(v);
    return 0n;
  } catch {
    return 0n;
  }
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function fmtDuration(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${Math.max(1, m)}m`;
}

function ProgressRing(props: { value: number; tone: "blue" | "emerald" | "amber"; children: React.ReactNode }) {
  const value = clamp01(props.value);
  const palette = {
    blue: { on: "rgba(96, 165, 250, 0.95)", track: "rgba(148, 163, 184, 0.12)" },
    emerald: { on: "rgba(52, 211, 153, 0.95)", track: "rgba(148, 163, 184, 0.12)" },
    amber: { on: "rgba(251, 191, 36, 0.95)", track: "rgba(148, 163, 184, 0.12)" },
  }[props.tone];

  return (
    <div
      className="relative w-14 h-14 rounded-full shadow-sm"
      style={{
        background: `conic-gradient(${palette.on} ${Math.round(value * 360)}deg, ${palette.track} 0deg)`,
      }}
    >
      <div
        className="absolute rounded-full bg-slate-950/70 border border-slate-800/60"
        style={{ top: 3, right: 3, bottom: 3, left: 3 }}
      />
      <div className="absolute inset-0 flex items-center justify-center">{props.children}</div>
    </div>
  );
}

export function CirclePage() {
  const auth = useAuth();
  const params = useParams();
  const circleId = String(params.circleId ?? "");

  const { wallet, sendTransaction } = useSmartWallet(); // Use Smart Wallet

  const [data, setData] = useState<CircleStatusResponse | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [busy, setBusy] = useState<string | null>(null);

  const [contractAddressInput, setContractAddressInput] = useState<string>("");
  const [collateralUsdt, setCollateralUsdt] = useState<string>("0");
  const [prefundUsdt, setPrefundUsdt] = useState<string>("0");
  const [nowSec, setNowSec] = useState<number>(() => Math.floor(Date.now() / 1000));

  const canLoad = auth.status === "ready" && circleId.length > 0;
  const humanError = error ? describeError(error) : null;

  const refresh = async () => {
    if (!canLoad) return;
    setLoading(true);
    setError(null);
    try {
      const res = await getCircleStatus(auth.token, circleId);
      setData(res);
    } catch (e: unknown) {
      const err = (e ?? {}) as Partial<ApiError>;
      setError({ code: err.code ?? "API_ERROR", message: err.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canLoad, circleId]);

  useEffect(() => {
    const id = window.setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 1000);
    return () => window.clearInterval(id);
  }, []);

  const circle = data?.circle ?? null;
  const member = data?.member ?? null;

  const contributionUnits = circle ? BigInt(circle.contribution_units) : 0n;
  const potUnits = circle ? BigInt(circle.n_members) * contributionUnits : 0n;
  const collateralRequiredUnits = circle ? (potUnits * BigInt(circle.collateral_rate_bps)) / 10_000n : 0n;
  const missingCollateralUnits = collateralRequiredUnits > toBigIntSafe(member?.collateral) ? collateralRequiredUnits - toBigIntSafe(member?.collateral) : 0n;

  useEffect(() => {
    if (!circle) return;
    if (collateralUsdt === "0") {
      const suggested = missingCollateralUnits > 0n ? formatUsdt(missingCollateralUnits) : formatUsdt(collateralRequiredUnits);
      if (suggested !== "0") setCollateralUsdt(suggested);
    }
    if (prefundUsdt === "0") {
      const suggested = formatUsdt(contributionUnits);
      if (suggested !== "0") setPrefundUsdt(suggested);
    }
  }, [circle, contributionUnits, collateralRequiredUnits, missingCollateralUnits, collateralUsdt, prefundUsdt]);

  const ctas = useMemo(() => {
    if (!circle) return [];
    const out: Array<{ label: string; to: string; variant?: "default" | "secondary" | "danger" | "ghost" | "link" }> = [];
    const status = String(circle.status);
    const withdrawable = toBigIntSafe(member?.withdrawable);
    const isOnchainJoined = String(member?.join_status ?? "") === "onchain_joined";
    const deposits = isOnchainJoined ? toBigIntSafe(member?.collateral) + toBigIntSafe(member?.prefund) : 0n;

    const commitEnd = circle.onchain_commit_end_at ? Math.floor(Date.parse(String(circle.onchain_commit_end_at)) / 1000) : 0;
    const revealEnd = circle.onchain_reveal_end_at ? Math.floor(Date.parse(String(circle.onchain_reveal_end_at)) / 1000) : 0;
    const now = Math.floor(Date.now() / 1000);
    const auctionOpen = Boolean(commitEnd && revealEnd && now < revealEnd);

    if (status === "Recruiting") {
      if (!isOnchainJoined) out.push({ label: "Join Circle", to: `/circle/${circleId}/join`, variant: "default" });
      if (isOnchainJoined) out.push({ label: deposits > 0n ? "Exit & Refund" : "Exit Circle", to: `/circle/${circleId}/withdraw`, variant: "danger" });
      return out;
    }

    if (status === "Active") {
      if (withdrawable > 0n) out.push({ label: "Withdraw Funds", to: `/circle/${circleId}/withdraw`, variant: "default" });
      if (auctionOpen) out.push({ label: "Go to Auction", to: `/circle/${circleId}/auction`, variant: "default" });
      return out;
    }

    if (status === "Completed" || status === "Terminated" || status === "EmergencyStop") {
      out.push({ label: "Withdraw All", to: `/circle/${circleId}/withdraw`, variant: "default" });
      return out;
    }

    return out;
  }, [circle, circleId, member]);

  const connectedWalletAddress = wallet?.account?.address ? String(wallet.account.address) : null;
  const boundWalletAddress = member?.wallet_address ? String(member.wallet_address) : null;
  const walletMatchesMember = useMemo(() => {
    if (!connectedWalletAddress || !boundWalletAddress) return true;
    try {
      return Address.parse(connectedWalletAddress).equals(Address.parse(boundWalletAddress));
    } catch {
      return true; // Assume true if mock or invalid address format
    }
  }, [connectedWalletAddress, boundWalletAddress]);

  // Derived states for admin actions
  const dueAtSec = circle?.onchain_due_at ? Math.floor(Date.parse(String(circle.onchain_due_at)) / 1000) : null;
  const graceEndSec = circle?.onchain_grace_end_at ? Math.floor(Date.parse(String(circle.onchain_grace_end_at)) / 1000) : null;
  const revealEndSec = circle?.onchain_reveal_end_at ? Math.floor(Date.parse(String(circle.onchain_reveal_end_at)) / 1000) : null;
  const phaseCode = circle?.onchain_phase ?? null;

  const canRunDebit = Boolean(
    circle?.contract_address &&
      dueAtSec &&
      graceEndSec &&
      Number.isFinite(dueAtSec) &&
      Number.isFinite(graceEndSec) &&
      nowSec >= dueAtSec &&
      nowSec < graceEndSec &&
      (phaseCode === 0 || phaseCode == null) &&
      !circle.onchain_commit_end_at
  );

  const canFinalizeAuction = Boolean(
    circle?.contract_address &&
      revealEndSec &&
      Number.isFinite(revealEndSec) &&
      nowSec >= revealEndSec &&
      (phaseCode === 1 || phaseCode === 2 || phaseCode == null) &&
      String(circle.status) === "Active"
  );

  const canTerminateDefault = Boolean(
    circle?.contract_address &&
      graceEndSec &&
      Number.isFinite(graceEndSec) &&
      nowSec >= graceEndSec &&
      !circle.onchain_commit_end_at &&
      (phaseCode === 3 || phaseCode === 0 || phaseCode == null) &&
      (String(circle.status) === "Locked" || String(circle.status) === "Active")
  );

  return (
    <Page title={circle?.name ?? "Circle"}>
      <div className="space-y-6">
        <FundsBanner />
        <IndexerLagBanner circle={circle} />

        {/* Top Nav */}
        <div className="flex items-center justify-between">
          <Link to="/" className="text-sm text-slate-400 hover:text-slate-100 transition-colors flex items-center gap-1">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
              <path fillRule="evenodd" d="M17 10a.75.75 0 01-.75.75H5.612l4.158 3.96a.75.75 0 11-1.04 1.08l-5.5-5.25a.75.75 0 010-1.08l5.5-5.25a.75.75 0 111.04 1.08L5.612 9.25H16.25A.75.75 0 0117 10z" clipRule="evenodd" />
            </svg>
            Back
          </Link>
          <div className="flex items-center gap-3">
             <Button className="h-8 px-3 text-xs" variant="ghost" onClick={() => void refresh()} disabled={loading || !!busy}>
              {loading ? "Refreshing..." : "Refresh"}
            </Button>
            <TonConnectButton className="scale-90 origin-right" />
          </div>
        </div>

        {error && humanError ? (
          <Card className="border-red-900/50 bg-red-950/20">
            <CardContent>
               <h3 className="text-red-400 font-bold mb-1">{humanError.title}</h3>
               <p className="text-red-200/70 text-sm">{humanError.description}</p>
            </CardContent>
          </Card>
        ) : null}
        
        {busy && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm text-white font-display text-xl animate-pulse">{busy}</div>}

        {!circle ? (
          <div className="text-center py-12 text-slate-500">Loading circle details...</div>
        ) : (
          <>
            {/* Header Info */}
            <div>
              <div className="flex items-center gap-3 mb-2">
                 <h1 className="text-2xl font-display font-bold text-slate-50">{circle.name ?? `Circle #${circle.circle_id}`}</h1>
                 <Badge variant="success" className="h-6 px-3">{displayStatus(String(circle.status))}</Badge>
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-500 font-mono">
                <span>Contract:</span>
                {circle.contract_address ? (
                  <span className="bg-slate-800 px-1.5 py-0.5 rounded text-slate-300">{circle.contract_address.slice(0, 4)}...{circle.contract_address.slice(-4)}</span>
                ) : <span className="text-orange-400">Not Deployed</span>}
              </div>
            </div>

            {/* CTAs Main */}
            {ctas.length > 0 && (
              <div className="grid grid-cols-2 gap-3">
                {ctas.map((c) => (
                  <Link key={c.to} to={c.to} className="w-full col-span-2 last:col-span-2 sm:col-span-1">
                    <Button variant={c.variant as any} className="w-full text-base py-6 shadow-lg shadow-blue-900/20">
                       {c.label}
                    </Button>
                  </Link>
                ))}
              </div>
            )}

            {/* Stats Grid */}
            <div className="grid grid-cols-2 gap-3">
               <StatItem label="Contribution" value={`${formatUsdt(contributionUnits)} USDT`} />
               <StatItem label="Pool Size" value={`${formatUsdt(potUnits)} USDT`} sub={`${circle.n_members} Members`} />
               <StatItem label="Collateral" value={`${(Number(circle.collateral_rate_bps)/100).toFixed(0)}%`} sub={`of Pool`} />
               <StatItem label="Round" value={String(circle.round_id ?? 0)} sub="Current" />
            </div>

            {/* OnChain Schedule */}
            <OnChainScheduleCard circle={circle} />

            {/* My Position (Vault) */}
            <Card className="border-blue-500/20 bg-slate-900/80">
              <CardHeader className="pb-2">
                <CardTitle className="text-blue-100 flex items-center gap-2">
                   <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-blue-500">
                     <path fillRule="evenodd" d="M1 4a1 1 0 011-1h16a1 1 0 011 1v8a1 1 0 01-1 1H2a1 1 0 01-1-1V4zm12 4a3 3 0 11-6 0 3 3 0 016 0zM4 9a1 1 0 100-2 1 1 0 000 2zm13-1a1 1 0 11-2 0 1 1 0 012 0zM1.75 14.5a.75.75 0 000 1.5c4.417 0 8.693.603 12.749 1.73 1.111.309 2.251-.512 2.251-1.696v-.784a.75.75 0 00-1.5 0v.784a27.2 27.2 0 01-13.5-1.54z" clipRule="evenodd" />
                   </svg>
                   My Vault
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {member ? (
                  <>
                    <div className="grid grid-cols-2 gap-4">
                       <div>
                          <div className="text-xs text-slate-500">Withdrawable</div>
                          <div className="text-lg font-mono-safe font-bold text-emerald-400">{formatUsdt(toBigIntSafe(member.withdrawable))} <span className="text-xs">USDT</span></div>
                       </div>
                       <div>
                          <div className="text-xs text-slate-500">Total Deposit</div>
                          <div className="text-lg font-mono-safe font-bold text-slate-200">
                            {formatUsdt(toBigIntSafe(member.collateral) + toBigIntSafe(member.prefund))} <span className="text-xs">USDT</span>
                          </div>
                       </div>
                    </div>
                    
                    <div className="pt-4 border-t border-slate-800 space-y-2">
                       <div className="flex justify-between text-sm">
                          <span className="text-slate-400">Credit (Debt)</span>
                          <span className="text-slate-200">{formatUsdt(toBigIntSafe(member.credit))}</span>
                       </div>
                       <div className="flex justify-between text-sm">
                          <span className="text-slate-400">Vesting Locked</span>
                          <span className="text-slate-200">{formatUsdt(toBigIntSafe(member.vesting_locked))}</span>
                       </div>
                       <div className="flex justify-between text-sm">
                          <span className="text-slate-400">Future Locked</span>
                          <span className="text-slate-200">{formatUsdt(toBigIntSafe(member.future_locked))}</span>
                       </div>
                    </div>
                  </>
                ) : (
                  <div className="text-sm text-slate-400 italic text-center py-2">You are not a member of this circle.</div>
                )}
              </CardContent>
            </Card>

            {/* Deposit Actions */}
            {circle.contract_address && String(circle.status) !== "Completed" && String(circle.status) !== "Terminated" && (
               <Card>
                 <CardHeader>
                   <CardTitle>Add Funds</CardTitle>
                 </CardHeader>
                 <CardContent className="space-y-4">
                    <div className="grid gap-2">
                        <label className="text-xs text-slate-400 font-bold uppercase">Collateral (Security Deposit)</label>
                        <div className="flex gap-2">
                           <input
                            className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-blue-500"
                            value={collateralUsdt}
                            onChange={(e) => setCollateralUsdt(e.target.value)}
                            inputMode="decimal"
                            placeholder="Amount"
                           />
                           <Button onClick={async () => {
                              if (auth.status !== "ready") return;
                              if (!wallet) { setError({ code: "WALLET_NOT_CONNECTED", message: "Connect wallet first." }); return; }
                              if (!walletMatchesMember) { setError({ code: "WALLET_MISMATCH", message: "Switch to bound wallet." }); return; }
                              if (!circle.onchain_jetton_wallet) { setError({ code: "JETTON_WALLET_NOT_INITIALIZED", message: "Contract wallet not ready." }); return; }
                              
                              setBusy("Sign Collateral Deposit...");
                              setError(null);
                              try {
                                const intent = await depositIntent(auth.token, { circle_id: circleId, purpose: "collateral", amount_usdt: collateralUsdt });
                                await sendTransaction({ // Replaced tonConnectUI
                                  validUntil: Math.floor(Date.now() / 1000) + 300,
                                  messages: [{ address: intent.jetton_wallet, amount: intent.tx_value_nano, payload: intent.payload_base64 }]
                                });
                                await refresh();
                              } catch(e: any) {
                                setError({ code: "TX_FAILED", message: e.message });
                              } finally { setBusy(null); }
                           }} disabled={!!busy}>Deposit</Button>
                        </div>
                    </div>

                    <div className="grid gap-2">
                        <label className="text-xs text-slate-400 font-bold uppercase">Prefund (Future Payments)</label>
                        <div className="flex gap-2">
                           <input
                            className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-blue-500"
                            value={prefundUsdt}
                            onChange={(e) => setPrefundUsdt(e.target.value)}
                            inputMode="decimal"
                            placeholder="Amount"
                           />
                           <Button onClick={async () => {
                              if (auth.status !== "ready") return;
                              if (!wallet) { setError({ code: "WALLET_NOT_CONNECTED", message: "Connect wallet first." }); return; }
                              if (!walletMatchesMember) { setError({ code: "WALLET_MISMATCH", message: "Switch to bound wallet." }); return; }
                              if (!circle.onchain_jetton_wallet) { setError({ code: "JETTON_WALLET_NOT_INITIALIZED", message: "Contract wallet not ready." }); return; }

                              setBusy("Sign Prefund Deposit...");
                              setError(null);
                              try {
                                const intent = await depositIntent(auth.token, { circle_id: circleId, purpose: "prefund", amount_usdt: prefundUsdt });
                                await sendTransaction({ // Replaced tonConnectUI
                                  validUntil: Math.floor(Date.now() / 1000) + 300,
                                  messages: [{ address: intent.jetton_wallet, amount: intent.tx_value_nano, payload: intent.payload_base64 }]
                                });
                                await refresh();
                              } catch(e: any) {
                                setError({ code: "TX_FAILED", message: e.message });
                              } finally { setBusy(null); }
                           }} disabled={!!busy}>Deposit</Button>
                        </div>
                    </div>
                 </CardContent>
               </Card>
            )}

            {/* Admin / Setup Zone (Hidden if all good) */}
            <div className="pt-8 pb-4">
              <div className="text-xs font-bold text-slate-600 uppercase tracking-widest text-center mb-4">— Admin & Safety —</div>
              
              <div className="space-y-4 opacity-80 hover:opacity-100 transition-opacity">
                {String(circle.status) === "Recruiting" && !circle.contract_address && (
                  <Card className="border-dashed border-slate-700">
                    <CardHeader><CardTitle>Setup: Attach Contract</CardTitle></CardHeader>
                    <CardContent>
                       <div className="flex gap-2">
                          <input 
                            className="flex-1 bg-slate-900 border border-slate-700 rounded p-2 text-sm"
                            value={contractAddressInput} 
                            onChange={e => setContractAddressInput(e.target.value)} 
                            placeholder="Contract Address"
                          />
                          <Button onClick={async () => {
                             setBusy("Attaching...");
                             try { await attachContract(auth.token, { circle_id: circleId, contract_address: contractAddressInput }); await refresh(); }
                             catch(e: any) { setError({code: "API", message: e.message}); }
                             finally { setBusy(null); }
                          }} disabled={!!busy}>Attach</Button>
                       </div>
                    </CardContent>
                  </Card>
                )}

                {circle.contract_address && !circle.onchain_jetton_wallet && (
                   <div className="text-center">
                      <Button variant="ghost" onClick={async () => {
                         setBusy("Initializing Wallet...");
                         try {
                           await sendTransaction({ // Replaced
                             validUntil: Math.floor(Date.now()/1000)+300,
                             messages: [{ address: circle.contract_address!, amount: toNano("0.05"), payload: buildInitJettonWalletPayload() }]
                           });
                         } catch(e: any) { setError({code: "TX", message: e.message}); }
                         finally { setBusy(null); }
                      }} disabled={!!busy}>⚠️ Init Contract Wallet (Required)</Button>
                   </div>
                )}

                {/* Keep Alive / Emergency Actions */}
                {circle.contract_address && (
                  <div className="grid grid-cols-2 gap-2">
                     <Button variant="secondary" disabled={!canRunDebit || !!busy} onClick={async () => {
                        if(!confirm("Run debit?")) return;
                        setBusy("Debit...");
                        try {
                           await sendTransaction({ // Replaced
                             validUntil: Math.floor(Date.now()/1000)+300,
                             messages: [{ address: circle.contract_address!, amount: toNano("0.05"), payload: buildTriggerDebitAllPayload() }]
                           });
                        } catch(e: any) { setError({code: "TX", message: e.message}); } finally { setBusy(null); }
                     }}>Force Debit</Button>
                     
                     <Button variant="secondary" disabled={!canFinalizeAuction || !!busy} onClick={async () => {
                        if(!confirm("Finalize Auction?")) return;
                        setBusy("Finalizing...");
                        try {
                           await sendTransaction({ // Replaced
                             validUntil: Math.floor(Date.now()/1000)+300,
                             messages: [{ address: circle.contract_address!, amount: toNano("0.05"), payload: buildFinalizeAuctionPayload() }]
                           });
                        } catch(e: any) { setError({code: "TX", message: e.message}); } finally { setBusy(null); }
                     }}>Finalize Auction</Button>

                     <Button className="col-span-2 mt-2" variant="danger" disabled={!canTerminateDefault || !!busy} onClick={async () => {
                        if(!confirm("TERMINATE DEFAULT? Irreversible.")) return;
                        setBusy("Terminating...");
                        try {
                           await sendTransaction({ // Replaced
                             validUntil: Math.floor(Date.now()/1000)+300,
                             messages: [{ address: circle.contract_address!, amount: toNano("0.05"), payload: buildTerminateDefaultPayload() }]
                           });
                        } catch(e: any) { setError({code: "TX", message: e.message}); } finally { setBusy(null); }
                     }}>Terminate Default</Button>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </Page>
  );
}
