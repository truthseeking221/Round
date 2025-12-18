import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { TonConnectButton } from "@tonconnect/ui-react";

import type { ApiError, CirclesListResponse } from "../lib/api";
import { listCircles } from "../lib/api";
import { useAuth } from "../auth/useAuth";
import { cn } from "../lib/cn";
import { formatUsdt } from "../lib/usdt";
import { Page, EmptyState, LoadingState } from "../components/layout/Page";
import { Card, CardContent, AlertCard, StatCard } from "../components/ui/Card";
import { Badge, getStatusBadgeVariant, SecureBadge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { describeError } from "../lib/errors";

// ============================================
// CIRCLE LIST ITEM
// ============================================

type TabKey = "active" | "recruiting" | "past";

interface CircleItemProps {
  circle: {
    circle_id: string;
    name?: string | null;
    status: string;
    n_members: number;
    contribution_units: string;
    current_cycle_index: number;
    onchain_due_at?: string | null;
  };
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function fmtDue(iso: string | null | undefined): { label: string; variant: "secondary" | "warning" | "error" } | null {
  if (!iso) return null;
  const dueMs = Date.parse(String(iso));
  if (!Number.isFinite(dueMs)) return null;

  const diffMs = dueMs - Date.now();
  const hours = diffMs / 3_600_000;

  if (hours <= -1) return { label: "Overdue", variant: "error" };
  if (hours < 24) return { label: `Due in ${Math.max(1, Math.ceil(hours))}h`, variant: "warning" };
  const days = Math.ceil(hours / 24);
  return { label: `Due in ${days}d`, variant: "secondary" };
}

function ProgressRing(props: { value: number; tone: "blue" | "emerald" | "slate"; children?: ReactNode }) {
  const value = clamp01(props.value);
  const palette = {
    blue: { on: "rgba(96, 165, 250, 0.95)", track: "rgba(148, 163, 184, 0.12)" },
    emerald: { on: "rgba(52, 211, 153, 0.95)", track: "rgba(148, 163, 184, 0.12)" },
    slate: { on: "rgba(148, 163, 184, 0.5)", track: "rgba(148, 163, 184, 0.10)" },
  }[props.tone];

  return (
    <div
      className="relative w-11 h-11 rounded-full shadow-sm"
      style={{
        background: `conic-gradient(${palette.on} ${Math.round(value * 360)}deg, ${palette.track} 0deg)`,
      }}
    >
      <div
        className="absolute rounded-full bg-slate-950/70 border border-slate-800/60"
        style={{ top: 2, right: 2, bottom: 2, left: 2 }}
      />
      <div className="absolute inset-0 flex items-center justify-center text-[11px] font-semibold text-slate-100">
        {props.children}
      </div>
    </div>
  );
}

function CircleItem({ circle }: CircleItemProps) {
  const contribution = formatUsdt(BigInt(circle.contribution_units));
  const potSize = formatUsdt(BigInt(circle.n_members) * BigInt(circle.contribution_units));
  const due = fmtDue(circle.onchain_due_at);

  const status = String(circle.status);
  const ringTone: "blue" | "emerald" | "slate" =
    status === "Recruiting" ? "blue" : status === "Active" || status === "Locked" ? "emerald" : "slate";
  const ringValue =
    status === "Active" || status === "Locked"
      ? clamp01((Number(circle.current_cycle_index ?? 0) + 1) / Math.max(1, Number(circle.n_members ?? 1)))
      : status === "Recruiting"
        ? 0.25
        : 1;

  return (
    <Link to={`/circle/${circle.circle_id}`}>
      <Card
        variant="interactive"
        className={cn(
          "group transition-all duration-200",
          "hover:border-blue-500/30 hover:shadow-lg hover:shadow-blue-900/10"
        )}
      >
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <ProgressRing value={ringValue} tone={ringTone}>
              {circle.n_members}
            </ProgressRing>

            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-slate-100 truncate">
                      {circle.name || `Circle #${circle.circle_id.slice(0, 8)}`}
                    </h3>
                    <Badge variant={getStatusBadgeVariant(circle.status)} className="shrink-0">
                      {circle.status}
                    </Badge>
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-xs text-slate-400">
                    <span className="inline-flex items-center gap-1">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                      </svg>
                      {circle.n_members} members
                    </span>
                    <span className="text-slate-600">•</span>
                    <span className="truncate">{contribution} USDT / cycle</span>
                  </div>
                </div>

                <div className="shrink-0 text-right">
                  <div className="text-lg font-semibold text-slate-100 font-mono-safe leading-tight">
                    {potSize}
                  </div>
                  <div className="text-[11px] text-slate-500">Pool per round</div>
                  {due ? (
                    <div className="mt-2">
                      <Badge variant={due.variant} className="font-mono text-[10px]">
                        {due.label}
                      </Badge>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

// ============================================
// MAIN HOME PAGE
// ============================================

export function HomePage() {
  const auth = useAuth();
  const [data, setData] = useState<CirclesListResponse | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabKey>("active");
  const humanError = error ? describeError(error) : null;

  useEffect(() => {
    let cancelled = false;
    
    async function fetchCircles() {
      if (auth.status !== "ready") return;
      
      setLoading(true);
      try {
        const res = await listCircles(auth.token);
        if (!cancelled) {
          setData(res);
          setError(null);
        }
      } catch (e: unknown) {
        const err = (e ?? {}) as Partial<ApiError>;
        if (!cancelled) {
          setError({ code: err.code ?? "API_ERROR", message: err.message });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    
    void fetchCircles();
    return () => { cancelled = true; };
  }, [auth.status, auth.token]);

  // Group circles by status
  const grouped = useMemo(() => {
    const circles = data?.circles ?? [];
    const active: typeof circles = [];
    const recruiting: typeof circles = [];
    const past: typeof circles = [];

    for (const c of circles) {
      if (c.status === "Active" || c.status === "Locked") {
        active.push(c);
      } else if (c.status === "Recruiting") {
        recruiting.push(c);
      } else {
        past.push(c);
      }
    }

    return { active, recruiting, past };
  }, [data?.circles]);

  const totalCircles = (data?.circles ?? []).length;
  const activeCount = grouped.active.length;
  const recruitingCount = grouped.recruiting.length;
  const pastCount = grouped.past.length;

  const currentList = tab === "active" ? grouped.active : tab === "recruiting" ? grouped.recruiting : grouped.past;
  const emptyCopy =
    tab === "active"
      ? { title: "No active circles", description: "Join a recruiting circle or create your own" }
      : tab === "recruiting"
        ? { title: "No circles recruiting", description: "Be the first to create a new circle" }
        : { title: "No past circles", description: "Completed circles will appear here" };

  return (
    <Page title="MoneyCircle" subtitle="Secure rotating savings on TON" headerAction={<TonConnectButton />}>
      <div className="space-y-5">
        {/* Hero */}
        <Card variant="vault" className="animate-slide-up">
          <CardContent className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Group</div>
                <div className="mt-1 text-base font-semibold text-slate-100 truncate">
                  {auth.group?.title ?? "Open inside a Telegram group"}
                </div>
                <div className="mt-1 text-xs text-slate-400">
                  On-chain rules, transparent schedule, no intermediaries.
                </div>
              </div>
              <SecureBadge />
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <StatCard
                label="Active"
                value={String(activeCount)}
                subValue={activeCount === 1 ? "circle in progress" : "circles in progress"}
                icon={
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                }
              />
              <StatCard
                label="Recruiting"
                value={String(recruitingCount)}
                subValue={recruitingCount === 1 ? "circle open" : "circles open"}
                icon={
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                  </svg>
                }
              />
            </div>

            {auth.group ? (
              <div className="mt-4">
                <Link to="/create">
                  <Button className="w-full">
                    <svg className="w-4 h-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    Create Circle
                  </Button>
                </Link>

                <details className="mt-3 rounded-xl border border-slate-800/60 bg-slate-950/40">
                  <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-slate-300">
                    How it works (15 seconds)
                  </summary>
                  <div className="px-3 pb-3 text-xs text-slate-400 leading-relaxed">
                    In each cycle, one member receives the pot. You place a blind bid by entering{" "}
                    <span className="text-slate-200 font-medium">how much you want to receive</span>. The person willing to
                    receive the least wins the cycle. The difference becomes credits for other members (reduces their next
                    payment).
                  </div>
                </details>
              </div>
            ) : null}
          </CardContent>
        </Card>

        {!auth.group ? (
          <AlertCard variant="info" title="Open in Telegram">
            Open the mini app inside a Telegram group to create or join circles.
          </AlertCard>
        ) : null}

        {/* Error state */}
        {error && humanError && (
          <AlertCard variant="error" title={humanError.title}>
            {humanError.description}
            <div className="mt-2 text-xs text-slate-500">Code: {error.code}</div>
          </AlertCard>
        )}

        {/* Loading state */}
        {loading && <LoadingState message="Loading circles..." />}

        {!loading ? (
          <div className="space-y-3">
            {/* Segmented tabs */}
            <div className="rounded-2xl border border-slate-800/60 bg-slate-900/40 p-1">
              {([
                { key: "active" as const, label: "Active", count: activeCount },
                { key: "recruiting" as const, label: "Recruiting", count: recruitingCount },
                { key: "past" as const, label: "Past", count: pastCount },
              ] satisfies Array<{ key: TabKey; label: string; count: number }>).map((t) => {
                const selected = tab === t.key;
                return (
                  <button
                    key={t.key}
                    onClick={() => setTab(t.key)}
                    className={cn(
                      "w-1/3 rounded-xl px-3 py-2 text-xs font-medium transition-all",
                      selected
                        ? "bg-slate-950 text-slate-100 shadow-sm border border-slate-800/60"
                        : "text-slate-400 hover:text-slate-100"
                    )}
                    type="button"
                  >
                    <span>{t.label}</span>
                    <span
                      className={cn(
                        "ml-2 inline-flex min-w-5 justify-center rounded-full px-1.5 py-0.5 text-[10px] font-mono",
                        selected ? "bg-slate-800/60 text-slate-200" : "bg-slate-800/40 text-slate-400"
                      )}
                    >
                      {t.count}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* List */}
            {currentList.length === 0 ? (
              <EmptyState
                title={emptyCopy.title}
                description={emptyCopy.description}
                action={
                  tab !== "past" && auth.group ? (
                    <Link to="/create">
                      <Button size="sm" className="w-auto">
                        Create Circle
                      </Button>
                    </Link>
                  ) : null
                }
              />
            ) : (
              <div className={cn("space-y-3", tab === "past" && "opacity-70")}>
                {currentList.map((c) => (
                  <CircleItem key={c.circle_id} circle={c} />
                ))}
              </div>
            )}
          </div>
        ) : null}

        {/* Stats footer */}
        {!loading && totalCircles > 0 && (
          <div className="text-center text-xs text-slate-500 pt-4">
            {totalCircles} circle{totalCircles !== 1 ? "s" : ""} in this group
          </div>
        )}
      </div>
    </Page>
  );
}
