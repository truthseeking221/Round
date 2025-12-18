import { TonConnectButton } from "@tonconnect/ui-react";
import { Address } from "@ton/core";
import { useEffect, useMemo, useState, type ReactNode } from "react";
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
import { Badge } from "../components/ui/Badge";
import { getStatusBadgeVariant } from "../components/ui/badgeVariants";
import { Button, type ButtonVariant } from "../components/ui/Button";
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

function ProgressRing(props: { value: number; tone: "blue" | "emerald" | "amber"; children: ReactNode }) {
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
  const isLeader = Boolean(auth.group?.bot_admin);

  const refresh = async () => {
    if (auth.status !== "ready" || circleId.length === 0) return;
    const token = auth.token;
    setLoading(true);
    setError(null);
    try {
      const res = await getCircleStatus(token, circleId);
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
    const out: Array<{ label: string; to: string; variant?: ButtonVariant }> = [];
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

  const dueCountdownSec = dueAtSec != null ? dueAtSec - nowSec : null;
  const dueLabel = dueCountdownSec != null ? (dueCountdownSec <= 0 ? "Due now" : `Due in ${fmtDuration(dueCountdownSec)}`) : null;

  const fundedCount = circle?.onchain_funded_count ?? null;
  const fundedTotal = circle?.n_members ?? null;
  const fundedRatio =
    fundedCount != null && fundedTotal != null && fundedTotal > 0 ? clamp01(fundedCount / fundedTotal) : null;

  const collateralAmount = Number.parseFloat(collateralUsdt);
  const prefundAmount = Number.parseFloat(prefundUsdt);
  const collateralAmountOk = Number.isFinite(collateralAmount) && collateralAmount > 0;
  const prefundAmountOk = Number.isFinite(prefundAmount) && prefundAmount > 0;

  const bottomDock =
    ctas.length > 0 ? (
      <div className={cn("grid gap-2", ctas.length > 1 ? "grid-cols-2" : "grid-cols-1")}>
        {ctas.map((c) => (
          <Link key={c.to} to={c.to} className={ctas.length === 1 ? "col-span-1" : undefined}>
            <Button variant={c.variant} className="w-full h-12 text-base">
              {c.label}
            </Button>
          </Link>
        ))}
      </div>
    ) : null;

  return (
    <Page
      title={circle?.name ?? "Circle"}
      subtitle={circle ? displayStatus(String(circle.status)) : undefined}
      leading={
        <Link
          to="/"
          className={cn(
            "inline-flex items-center justify-center h-10 w-10 rounded-xl",
            "border border-slate-800/60 bg-slate-950/40 text-slate-300",
            "hover:bg-slate-900/60 hover:text-slate-100 transition-colors"
          )}
          aria-label="Back"
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
      bottomDock={bottomDock}
    >
      <div className="space-y-6">
        <FundsBanner />
        <IndexerLagBanner circle={circle} />

        {error && humanError ? (
          <AlertCard variant="error" title={humanError.title}>
            {humanError.description}
            <div className="mt-2 text-xs text-slate-500">Code: {error.code}</div>
          </AlertCard>
        ) : null}
        
        {busy && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm text-white font-display text-xl animate-pulse">{busy}</div>}

        {!circle ? (
          <div className="text-center py-12 text-slate-500">Loading circle details...</div>
        ) : (
          <>
            <Card variant="vault" className="animate-slide-up">
              <CardContent className="p-4 space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={getStatusBadgeVariant(String(circle.status))} className="font-mono text-[10px]">
                        {displayStatus(String(circle.status))}
                      </Badge>
                      {dueLabel ? (
                        <Badge
                          variant={dueCountdownSec != null && dueCountdownSec <= 0 ? "warning" : "secondary"}
                          className="font-mono text-[10px]"
                        >
                          {dueLabel}
                        </Badge>
                      ) : null}
                    </div>

                    <div className="mt-3">
                      <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">
                        Pool per round
                      </div>
                      <div className="mt-1 text-3xl font-semibold text-slate-50 font-mono-safe leading-none">
                        {formatUsdt(potUnits)}
                        <span className="ml-1 text-xs text-slate-500 align-top">USDT</span>
                      </div>
                      <div className="mt-1 text-xs text-slate-400">
                        {formatUsdt(contributionUnits)} USDT per member • {circle.n_members} members
                      </div>
                    </div>
                  </div>

                  {fundedRatio != null && fundedCount != null ? (
                    <div className="shrink-0">
                      <ProgressRing
                        value={fundedRatio}
                        tone={fundedRatio >= 1 ? "emerald" : fundedRatio >= 0.5 ? "blue" : "amber"}
                      >
                        <div className="text-center">
                          <div className="text-sm font-semibold text-slate-100 font-mono-safe leading-none">
                            {fundedCount}/{circle.n_members}
                          </div>
                          <div className="mt-1 text-[10px] text-slate-500">Funded</div>
                        </div>
                      </ProgressRing>
                    </div>
                  ) : null}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <StatCard
                    label="Contribution"
                    value={`${formatUsdt(contributionUnits)} USDT`}
                    subValue="per member"
                    icon={
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-10V6m0 12v-2m9-4a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    }
                  />
                  <StatCard
                    label="Members"
                    value={String(circle.n_members)}
                    subValue="total slots"
                    icon={
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                      </svg>
                    }
                  />
                  <StatCard
                    label="Collateral"
                    value={`${(Number(circle.collateral_rate_bps) / 100).toFixed(0)}%`}
                    subValue="of pool"
                    icon={
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                      </svg>
                    }
                  />
                  <StatCard
                    label="Round"
                    value={String((circle.current_cycle_index ?? 0) + 1)}
                    subValue={Number.isFinite(circle.total_cycles) ? `of ${circle.total_cycles}` : "current"}
                    icon={
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                    }
                  />
                </div>

                <div className="flex items-center justify-between text-xs text-slate-500 font-mono">
                  <span>Contract</span>
                  {circle.contract_address ? (
                    <span className="inline-flex items-center rounded-lg bg-slate-900/60 border border-slate-800/60 px-2 py-1 text-slate-300">
                      {circle.contract_address.slice(0, 4)}…{circle.contract_address.slice(-4)}
                    </span>
                  ) : (
                    <span className="text-amber-400">Not deployed</span>
                  )}
                </div>
              </CardContent>
            </Card>

            {!walletMatchesMember && boundWalletAddress && connectedWalletAddress ? (
              <AlertCard variant="warning" title="Wrong wallet connected">
                Connect the wallet you joined with to deposit and withdraw.
                <div className="mt-2 grid gap-1 text-[11px] text-slate-400 font-mono">
                  <div>
                    Expected: {boundWalletAddress.slice(0, 6)}…{boundWalletAddress.slice(-6)}
                  </div>
                  <div>
                    Connected: {connectedWalletAddress.slice(0, 6)}…{connectedWalletAddress.slice(-6)}
                  </div>
                </div>
              </AlertCard>
            ) : null}

            {/* OnChain Schedule */}
            <OnChainScheduleCard circle={circle} nowMs={nowSec * 1000} />

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
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <CardTitle>Add funds</CardTitle>
                      <CardDescription>Deposits are recorded on-chain via smart contract notifications.</CardDescription>
                    </div>
                    <Badge
                      variant={circle.onchain_jetton_wallet ? "secondary" : "warning"}
                      className="font-mono text-[10px]"
                    >
                      {circle.onchain_jetton_wallet ? "Jetton ready" : "Init required"}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {!circle.onchain_jetton_wallet ? (
                    <div className="rounded-xl border border-amber-800/40 bg-amber-950/10 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-amber-100">One-time setup: Init contract wallet</div>
                          <div className="mt-1 text-[11px] text-amber-200/80 leading-relaxed">
                            Costs ~0.05 TON network fee. Only needs to be done once for this circle; any member can do it.
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={async () => {
                            if (!wallet) { setError({ code: "WALLET_NOT_CONNECTED", message: "Connect wallet first." }); return; }
                            setBusy("Initializing…");
                            setError(null);
                            try {
                              await sendTransaction({
                                validUntil: Math.floor(Date.now()/1000)+300,
                                messages: [{ address: circle.contract_address!, amount: toNano("0.05"), payload: buildInitJettonWalletPayload() }]
                              });
                              await refresh();
                            } catch (e: unknown) {
                              const maybe = (e ?? {}) as { message?: unknown };
                              setError({code: "TX_FAILED", message: typeof maybe.message === "string" ? maybe.message : "Transaction failed."});
                            } finally { setBusy(null); }
                          }}
                          disabled={!!busy}
                        >
                          Init now
                        </Button>
                      </div>
                    </div>
                  ) : null}

                  <div className="rounded-xl border border-slate-800/60 bg-slate-950/40 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-slate-200">Collateral</div>
                        <div className="mt-1 text-[11px] text-slate-500">
                          Required: {formatUsdt(collateralRequiredUnits)} USDT
                          {missingCollateralUnits > 0n ? ` • Missing: ${formatUsdt(missingCollateralUnits)} USDT` : ""}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="text-[11px] text-blue-400 hover:text-blue-300"
                        onClick={() => {
                          const v =
                            missingCollateralUnits > 0n ? formatUsdt(missingCollateralUnits) : formatUsdt(collateralRequiredUnits);
                          setCollateralUsdt(v);
                        }}
                      >
                        Use required
                      </button>
                    </div>

                    <div className="mt-3 flex items-center gap-2">
                      <div className="flex-1">
                        <Input
                          value={collateralUsdt}
                          onChange={(e) => setCollateralUsdt(e.target.value)}
                          inputMode="decimal"
                          placeholder="0"
                          className="font-mono"
                        />
                      </div>
                      <Button
                        onClick={async () => {
                          if (auth.status !== "ready") return;
                          if (!wallet) { setError({ code: "WALLET_NOT_CONNECTED", message: "Connect wallet first." }); return; }
                          if (!walletMatchesMember) { setError({ code: "WALLET_MISMATCH", message: "Switch to bound wallet." }); return; }
                          if (!circle.onchain_jetton_wallet) { setError({ code: "JETTON_WALLET_NOT_INITIALIZED", message: "Contract wallet not ready." }); return; }

                          setBusy("Sign collateral deposit…");
                          setError(null);
                          try {
                            const intent = await depositIntent(auth.token, { circle_id: circleId, purpose: "collateral", amount_usdt: collateralUsdt });
                            await sendTransaction({
                              validUntil: Math.floor(Date.now() / 1000) + 300,
                              messages: [{ address: intent.jetton_wallet, amount: intent.tx_value_nano, payload: intent.payload_base64 }]
                            });
                            await refresh();
                          } catch (e: unknown) {
                            const maybe = (e ?? {}) as { message?: unknown };
                            setError({ code: "TX_FAILED", message: typeof maybe.message === "string" ? maybe.message : "Transaction failed." });
                          } finally { setBusy(null); }
                        }}
                        disabled={!!busy || !collateralAmountOk}
                      >
                        Deposit
                      </Button>
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-800/60 bg-slate-950/40 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-slate-200">Prefund</div>
                        <div className="mt-1 text-[11px] text-slate-500">
                          Recommended: ≥ {formatUsdt(contributionUnits)} USDT (1 cycle)
                        </div>
                      </div>
                      <button
                        type="button"
                        className="text-[11px] text-blue-400 hover:text-blue-300"
                        onClick={() => setPrefundUsdt(formatUsdt(contributionUnits))}
                      >
                        Use 1 cycle
                      </button>
                    </div>

                    <div className="mt-3 flex items-center gap-2">
                      <div className="flex-1">
                        <Input
                          value={prefundUsdt}
                          onChange={(e) => setPrefundUsdt(e.target.value)}
                          inputMode="decimal"
                          placeholder="0"
                          className="font-mono"
                        />
                      </div>
                      <Button
                        onClick={async () => {
                          if (auth.status !== "ready") return;
                          if (!wallet) { setError({ code: "WALLET_NOT_CONNECTED", message: "Connect wallet first." }); return; }
                          if (!walletMatchesMember) { setError({ code: "WALLET_MISMATCH", message: "Switch to bound wallet." }); return; }
                          if (!circle.onchain_jetton_wallet) { setError({ code: "JETTON_WALLET_NOT_INITIALIZED", message: "Contract wallet not ready." }); return; }

                          setBusy("Sign prefund deposit…");
                          setError(null);
                          try {
                            const intent = await depositIntent(auth.token, { circle_id: circleId, purpose: "prefund", amount_usdt: prefundUsdt });
                            await sendTransaction({
                              validUntil: Math.floor(Date.now() / 1000) + 300,
                              messages: [{ address: intent.jetton_wallet, amount: intent.tx_value_nano, payload: intent.payload_base64 }]
                            });
                            await refresh();
                          } catch (e: unknown) {
                            const maybe = (e ?? {}) as { message?: unknown };
                            setError({ code: "TX_FAILED", message: typeof maybe.message === "string" ? maybe.message : "Transaction failed." });
                          } finally { setBusy(null); }
                        }}
                        disabled={!!busy || !prefundAmountOk}
                      >
                        Deposit
                      </Button>
                    </div>
                  </div>

                  <div className="text-[11px] text-slate-500 leading-relaxed">
                    Make sure you have enough TON for network fees. Deposits will appear after the indexer syncs.
                  </div>
                </CardContent>
              </Card>
            )}

            {isLeader ? (
              <details className="rounded-2xl border border-slate-800/60 bg-slate-900/30">
                <summary className="cursor-pointer select-none px-4 py-3 text-xs font-semibold text-slate-300 flex items-center justify-between">
                  <span>Leader tools</span>
                  <span className="text-[10px] font-mono text-slate-500">advanced</span>
                </summary>
                <div className="px-4 pb-4 space-y-4">
                  <AlertCard variant="warning" title="High-risk actions">
                    These actions cost TON fees and may be irreversible. Most members never need this section.
                  </AlertCard>

                {String(circle.status) === "Recruiting" && !circle.contract_address && (
                  <Card className="border-dashed border-slate-700">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base">Attach contract</CardTitle>
                      <CardDescription>Link the deployed contract address to this circle.</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="flex items-center gap-2">
                        <div className="flex-1">
                          <Input
                            value={contractAddressInput}
                            onChange={(e) => setContractAddressInput(e.target.value)}
                            placeholder="EQ… contract address"
                            className="font-mono"
                          />
                        </div>
                        <Button
                          onClick={async () => {
                            if (auth.status !== "ready") return;
                            setBusy("Attaching…");
                            try { await attachContract(auth.token, { circle_id: circleId, contract_address: contractAddressInput }); await refresh(); }
                            catch (e: unknown) {
                              const maybe = (e ?? {}) as { message?: unknown };
                              setError({code: "API", message: typeof maybe.message === "string" ? maybe.message : "Attach failed."});
                            }
                            finally { setBusy(null); }
                          }}
                          disabled={!!busy || contractAddressInput.trim().length === 0}
                        >
                          Attach
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {circle.contract_address && (
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      variant="secondary"
	                      disabled={!canRunDebit || !!busy}
	                      onClick={async () => {
	                        if(!confirm("Run debit? Costs TON fee.")) return;
	                        setBusy("Debiting…");
	                        try {
	                          await sendTransaction({
	                            validUntil: Math.floor(Date.now()/1000)+300,
                            messages: [{ address: circle.contract_address!, amount: toNano("0.05"), payload: buildTriggerDebitAllPayload() }]
                          });
                        } catch (e: unknown) {
                          const maybe = (e ?? {}) as { message?: unknown };
                          setError({code: "TX", message: typeof maybe.message === "string" ? maybe.message : "Transaction failed."});
                        } finally { setBusy(null); }
                      }}
                    >
                      Force Debit
                    </Button>

                    <Button
                      variant="secondary"
	                      disabled={!canFinalizeAuction || !!busy}
	                      onClick={async () => {
	                        if(!confirm("Finalize auction? Costs TON fee.")) return;
	                        setBusy("Finalizing…");
	                        try {
	                          await sendTransaction({
	                            validUntil: Math.floor(Date.now()/1000)+300,
                            messages: [{ address: circle.contract_address!, amount: toNano("0.05"), payload: buildFinalizeAuctionPayload() }]
                          });
                        } catch (e: unknown) {
                          const maybe = (e ?? {}) as { message?: unknown };
                          setError({code: "TX", message: typeof maybe.message === "string" ? maybe.message : "Transaction failed."});
                        } finally { setBusy(null); }
                      }}
                    >
                      Finalize
                    </Button>

                    <Button
                      className="col-span-2"
                      variant="danger"
	                      disabled={!canTerminateDefault || !!busy}
	                      onClick={async () => {
	                        if(!confirm("TERMINATE DEFAULT? Irreversible and costs TON fee.")) return;
	                        setBusy("Terminating…");
	                        try {
	                          await sendTransaction({
	                            validUntil: Math.floor(Date.now()/1000)+300,
                            messages: [{ address: circle.contract_address!, amount: toNano("0.05"), payload: buildTerminateDefaultPayload() }]
                          });
                        } catch (e: unknown) {
                          const maybe = (e ?? {}) as { message?: unknown };
                          setError({code: "TX", message: typeof maybe.message === "string" ? maybe.message : "Transaction failed."});
                        } finally { setBusy(null); }
                      }}
                    >
                      Terminate Default
                    </Button>
                  </div>
                )}
                </div>
              </details>
            ) : null}
          </>
        )}
      </div>
    </Page>
  );
}
