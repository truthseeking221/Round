import { TonConnectButton, useTonConnectUI, useTonWallet } from "@tonconnect/ui-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";

import type { ApiError, CircleStatusResponse } from "../lib/api";
import { attachContract, depositIntent, getCircleStatus } from "../lib/api";
import { useAuth } from "../auth/useAuth";
import { formatUsdt } from "../lib/usdt";
import { Page } from "../components/layout/Page";
import { FundsBanner } from "../components/mc/FundsBanner";
import { OnChainScheduleCard } from "../components/mc/OnChainScheduleCard";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card, CardDescription, CardTitle } from "../components/ui/Card";
import { buildInitJettonWalletPayload, toNano } from "../lib/tonPayloads";
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

export function CirclePage() {
  const auth = useAuth();
  const params = useParams();
  const circleId = String(params.circleId ?? "");

  const wallet = useTonWallet();
  const [tonConnectUI] = useTonConnectUI();

  const [data, setData] = useState<CircleStatusResponse | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [busy, setBusy] = useState<string | null>(null);

  const [contractAddressInput, setContractAddressInput] = useState<string>("");
  const [collateralUsdt, setCollateralUsdt] = useState<string>("0");
  const [prefundUsdt, setPrefundUsdt] = useState<string>("0");

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
    const out: Array<{ label: string; to: string }> = [];
    const status = String(circle.status);
    const withdrawable = toBigIntSafe(member?.withdrawable);
    const isOnchainJoined = String(member?.join_status ?? "") === "onchain_joined";
    const hasDeposits = isOnchainJoined && toBigIntSafe(member?.collateral) + toBigIntSafe(member?.prefund) > 0n;

    const commitEnd = circle.onchain_commit_end_at ? Math.floor(Date.parse(String(circle.onchain_commit_end_at)) / 1000) : 0;
    const revealEnd = circle.onchain_reveal_end_at ? Math.floor(Date.parse(String(circle.onchain_reveal_end_at)) / 1000) : 0;
    const now = Math.floor(Date.now() / 1000);
    const auctionOpen = Boolean(commitEnd && revealEnd && now < revealEnd);

    if (status === "Recruiting") {
      if (!isOnchainJoined) out.push({ label: "Join Circle", to: `/circle/${circleId}/join` });
      if (hasDeposits) out.push({ label: "Exit & Refund", to: `/circle/${circleId}/withdraw` });
      return out;
    }

    if (status === "Active") {
      if (withdrawable > 0n) out.push({ label: "Withdraw Now", to: `/circle/${circleId}/withdraw` });
      if (auctionOpen) out.push({ label: "Go to Auction", to: `/circle/${circleId}/auction` });
      return out;
    }

    if (status === "Completed" || status === "Terminated" || status === "EmergencyStop") {
      out.push({ label: "Withdraw All", to: `/circle/${circleId}/withdraw` });
      return out;
    }

    // Locked or unknown states: show read-only actions only.
    return out;
  }, [circle, circleId, member]);

  return (
    <Page title={circle?.name ?? "Circle"}>
      <div className="space-y-4">
        <FundsBanner />

        <div className="flex items-center justify-between gap-3">
          <Link to="/" className="text-sm text-slate-300 hover:text-slate-50">
            ← Back
          </Link>
          <div className="flex items-center gap-2">
            <TonConnectButton />
            <Button className="h-9 w-auto px-3" variant="ghost" onClick={() => void refresh()} disabled={loading || !!busy}>
              {loading ? "Refreshing…" : "Refresh"}
            </Button>
          </div>
        </div>

        {error && humanError ? (
          <Card>
            <CardTitle>{humanError.title}</CardTitle>
            <CardDescription>
              {humanError.description}
              <div className="mt-2 text-xs text-slate-500">Code: {error.code}</div>
            </CardDescription>
          </Card>
        ) : null}

        {busy ? <div className="text-sm text-slate-300">{busy}</div> : null}

        {!circle ? (
          <Card>
            <CardTitle>Loading…</CardTitle>
            <CardDescription>Fetching on-chain mirror.</CardDescription>
          </Card>
        ) : (
          <>
            <Card>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle>{circle.name ?? circle.circle_id}</CardTitle>
                  <CardDescription className="mt-1">
                    Contract: <code className="text-slate-200">{circle.contract_address ?? "(not attached)"}</code>
                  </CardDescription>
                </div>
                <Badge variant="default">{displayStatus(String(circle.status))}</Badge>
              </div>
            </Card>

            {String(circle.status) === "Recruiting" && !circle.contract_address ? (
              <Card>
                <CardTitle>Attach Contract (leader only)</CardTitle>
                <CardDescription className="mt-2">
                  Paste the deployed CircleContract address. Backend verifies code hash + config before saving.
                </CardDescription>

                <div className="mt-4 grid gap-2">
                  <input
                    className="w-full rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
                    value={contractAddressInput}
                    onChange={(e) => setContractAddressInput(e.target.value)}
                    placeholder="EQ..."
                  />
                  <Button
                    onClick={async () => {
                      if (auth.status !== "ready") return;
                      setBusy("Attaching contract…");
                      setError(null);
                      try {
                        await attachContract(auth.token, { circle_id: circleId, contract_address: contractAddressInput.trim() });
                        setContractAddressInput("");
                        await refresh();
                      } catch (e: unknown) {
                        const err = (e ?? {}) as Partial<ApiError>;
                        setError({ code: err.code ?? "API_ERROR", message: err.message });
                      } finally {
                        setBusy(null);
                      }
                    }}
                    disabled={!!busy || auth.status !== "ready" || contractAddressInput.trim().length === 0}
                  >
                    Attach
                  </Button>
                </div>
              </Card>
            ) : null}

            <OnChainScheduleCard circle={circle} />

            <Card>
              <CardTitle>Your Balances (On-chain)</CardTitle>
              {member ? (
                <div className="mt-3 space-y-1 text-sm text-slate-300">
                  <div>
                    Join status: <span className="text-slate-200">{String(member.join_status ?? "—")}</span>
                  </div>
                  <div>
                    Wallet:{" "}
                    {member.wallet_address ? <code className="text-slate-200">{member.wallet_address}</code> : <span className="text-slate-400">—</span>}
                  </div>
                  <div className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Balances</div>
                  <div>Collateral: {formatUsdt(toBigIntSafe(member.collateral))} USDT</div>
                  <div>Prefund: {formatUsdt(toBigIntSafe(member.prefund))} USDT</div>
                  <div>Credit: {formatUsdt(toBigIntSafe(member.credit))} USDT</div>
                  <div>Vesting Locked: {formatUsdt(toBigIntSafe(member.vesting_locked))} USDT</div>
                  <div>Locked for Future Payments: {formatUsdt(toBigIntSafe(member.future_locked))} USDT</div>
                  <div className="mt-2 font-semibold text-slate-100">Withdrawable Now: {formatUsdt(toBigIntSafe(member.withdrawable))} USDT</div>
                  <div>Due remaining: {formatUsdt(toBigIntSafe(member.due_remaining))} USDT</div>
                  {String(circle.status) === "Active" ? (
                    <div className="mt-2 text-xs text-slate-400">
                      While the circle is Active, you can only withdraw Withdrawable Now. Other funds remain locked by rules.
                    </div>
                  ) : null}
                </div>
              ) : (
                <CardDescription className="mt-2">You have not joined this circle yet.</CardDescription>
              )}
            </Card>

            {circle.contract_address ? (
              <Card>
                <CardTitle>Deposit Collateral &amp; Prefund</CardTitle>
                <CardDescription className="mt-2">
                  Make sure you have enough TON for network fees.
                  <br />
                  Your deposit is recorded via smart contract notifications.
                </CardDescription>

                <div className="mt-3 text-sm text-slate-300">
                  Contract Jetton wallet:{" "}
                  {circle.onchain_jetton_wallet ? <code className="text-slate-200">{circle.onchain_jetton_wallet}</code> : <span className="text-slate-400">Not initialized</span>}
                </div>

                <div className="mt-4 grid gap-2">
                  <Button
                    variant="ghost"
                    onClick={async () => {
                      if (!wallet) {
                        setError({ code: "WALLET_NOT_CONNECTED", message: "Connect wallet first." });
                        return;
                      }
                      setBusy("Sending INIT…");
                      setError(null);
                      try {
                        await tonConnectUI.sendTransaction({
                          validUntil: Math.floor(Date.now() / 1000) + 5 * 60,
                          messages: [
                            {
                              address: String(circle.contract_address),
                              amount: toNano("0.05"),
                              payload: buildInitJettonWalletPayload()
                            }
                          ]
                        });
                      } catch (e: unknown) {
                        const err = e as { message?: string };
                        setError({ code: "TX_FAILED", message: err?.message ?? "Transaction failed" });
                      } finally {
                        setBusy(null);
                      }
                    }}
                    disabled={!!busy}
                  >
                    Init Jetton Wallet (required once)
                  </Button>
                </div>

                <div className="mt-5 text-xs font-semibold uppercase tracking-wide text-slate-400">Deposits</div>
                <div className="mt-2 text-sm text-slate-300">
                  Required Collateral: {formatUsdt(collateralRequiredUnits)} USDT · Recommended Prefund: ≥ {formatUsdt(contributionUnits)} USDT
                </div>

                <div className="mt-3 grid gap-3">
                  <div className="grid gap-2">
                    <div className="text-sm text-slate-300">Collateral (USDT)</div>
                    <input
                      className="w-full rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
                      value={collateralUsdt}
                      onChange={(e) => setCollateralUsdt(e.target.value)}
                      inputMode="decimal"
                      placeholder="e.g. 10"
                    />
                    <Button
                      onClick={async () => {
                        if (auth.status !== "ready") return;
                        if (!wallet) {
                          setError({ code: "WALLET_NOT_CONNECTED", message: "Connect wallet first." });
                          return;
                        }
                        if (!circle.onchain_jetton_wallet) {
                          setError({ code: "JETTON_WALLET_NOT_INITIALIZED", message: "Run INIT first (contract Jetton wallet not set yet)." });
                          return;
                        }
                        if (String(member?.join_status ?? "") !== "onchain_joined") {
                          setError({ code: "NOT_ONCHAIN_MEMBER", message: "Join on-chain first before depositing." });
                          return;
                        }
                        setBusy("Preparing collateral deposit…");
                        setError(null);
                        try {
                          const intent = await depositIntent(auth.token, { circle_id: circleId, purpose: "collateral", amount_usdt: collateralUsdt });
                          setBusy("Sending deposit tx…");
                          await tonConnectUI.sendTransaction({
                            validUntil: Math.floor(Date.now() / 1000) + 5 * 60,
                            messages: [{ address: intent.jetton_wallet, amount: intent.tx_value_nano, payload: intent.payload_base64 }]
                          });
                          await refresh();
                        } catch (e: unknown) {
                          const err = (e ?? {}) as Partial<ApiError>;
                          setError({ code: err.code ?? "API_ERROR", message: err.message });
                        } finally {
                          setBusy(null);
                        }
                      }}
                      disabled={!!busy}
                    >
                      Deposit Collateral
                    </Button>
                  </div>

                  <div className="grid gap-2">
                    <div className="text-sm text-slate-300">Prefund (USDT)</div>
                    <input
                      className="w-full rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
                      value={prefundUsdt}
                      onChange={(e) => setPrefundUsdt(e.target.value)}
                      inputMode="decimal"
                      placeholder="e.g. 10"
                    />
                    <Button
                      onClick={async () => {
                        if (auth.status !== "ready") return;
                        if (!wallet) {
                          setError({ code: "WALLET_NOT_CONNECTED", message: "Connect wallet first." });
                          return;
                        }
                        if (!circle.onchain_jetton_wallet) {
                          setError({ code: "JETTON_WALLET_NOT_INITIALIZED", message: "Run INIT first (contract Jetton wallet not set yet)." });
                          return;
                        }
                        if (String(member?.join_status ?? "") !== "onchain_joined") {
                          setError({ code: "NOT_ONCHAIN_MEMBER", message: "Join on-chain first before depositing." });
                          return;
                        }
                        setBusy("Preparing prefund deposit…");
                        setError(null);
                        try {
                          const intent = await depositIntent(auth.token, { circle_id: circleId, purpose: "prefund", amount_usdt: prefundUsdt });
                          setBusy("Sending deposit tx…");
                          await tonConnectUI.sendTransaction({
                            validUntil: Math.floor(Date.now() / 1000) + 5 * 60,
                            messages: [{ address: intent.jetton_wallet, amount: intent.tx_value_nano, payload: intent.payload_base64 }]
                          });
                          await refresh();
                        } catch (e: unknown) {
                          const err = (e ?? {}) as Partial<ApiError>;
                          setError({ code: err.code ?? "API_ERROR", message: err.message });
                        } finally {
                          setBusy(null);
                        }
                      }}
                      disabled={!!busy}
                    >
                      Deposit Prefund
                    </Button>
                  </div>
                </div>
              </Card>
            ) : null}

            {ctas.length ? (
              <div className="grid gap-2">
                {ctas.map((c) => (
                  <Link key={c.to} to={c.to}>
                    <Button>{c.label}</Button>
                  </Link>
                ))}
              </div>
            ) : null}
          </>
        )}
      </div>
    </Page>
  );
}
