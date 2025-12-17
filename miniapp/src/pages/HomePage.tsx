import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import type { ApiError, CirclesListResponse } from "../lib/api";
import { listCircles } from "../lib/api";
import { useAuth } from "../auth/useAuth";
import { formatUsdt } from "../lib/usdt";
import { FundsBanner } from "../components/mc/FundsBanner";
import { Page } from "../components/layout/Page";
import { describeError } from "../lib/errors";

function displayStatus(status: string): string {
  return status === "EmergencyStop" ? "Emergency Stop" : status;
}

function StatusBadge(props: { status: string }) {
  return (
    <span style={{ padding: "2px 8px", borderRadius: 999, border: "1px solid rgba(255,255,255,0.25)", fontSize: 12 }}>
      {displayStatus(props.status)}
    </span>
  );
}

export function HomePage() {
  const auth = useAuth();
  const [data, setData] = useState<CirclesListResponse | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const humanError = error ? describeError(error) : null;

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (auth.status !== "ready") return;
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
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [auth.status, auth.token]);

  const grouped = useMemo(() => {
    const circles = data?.circles ?? [];
    const recruiting: typeof circles = [];
    const active: typeof circles = [];
    const past: typeof circles = [];
    for (const c of circles) {
      if (c.status === "Recruiting") recruiting.push(c);
      else if (c.status === "Locked" || c.status === "Active") active.push(c);
      else past.push(c);
    }
    return { recruiting, active, past };
  }, [data?.circles]);

  return (
    <Page title="MoneyCircle">
      <div className="space-y-4">
        <FundsBanner />

        <div className="flex items-center justify-between gap-3">
          {auth.group ? (
            <div className="text-sm text-slate-300">Group: {auth.group.title ?? auth.group.group_chat_id}</div>
          ) : (
            <div className="text-sm text-slate-300">Open the mini app inside a Telegram group to create/join circles.</div>
          )}
          <Link to="/create" className="text-sm text-sky-300 hover:text-sky-200">
            Create Circle
          </Link>
        </div>

        {error && humanError ? (
          <div style={{ border: "1px solid rgba(255,255,255,0.25)", borderRadius: 12, padding: 12 }}>
            <div style={{ fontWeight: 700 }}>{humanError.title}</div>
            <div style={{ opacity: 0.9 }}>{humanError.description}</div>
            <div style={{ marginTop: 6, fontSize: 12, opacity: 0.7 }}>Code: {error.code}</div>
          </div>
        ) : null}

        <section style={{ display: "grid", gap: 8 }}>
          <h2 style={{ fontSize: 16, margin: 0 }}>Active Circles</h2>
          {grouped.active.length === 0 ? <div style={{ opacity: 0.8 }}>No active circles.</div> : null}
          {grouped.active.map((c) => (
            <Link
              key={c.circle_id}
              to={`/circle/${c.circle_id}`}
              style={{ display: "block", padding: 12, borderRadius: 12, border: "1px solid rgba(255,255,255,0.2)" }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <div style={{ fontWeight: 700 }}>{c.name ?? c.circle_id}</div>
                <StatusBadge status={c.status} />
              </div>
              <div style={{ opacity: 0.85, fontSize: 13 }}>
                N={c.n_members} · C={formatUsdt(BigInt(c.contribution_units))} USDT
              </div>
            </Link>
          ))}
        </section>

        <section style={{ display: "grid", gap: 8 }}>
          <h2 style={{ fontSize: 16, margin: 0 }}>Recruiting Circles</h2>
          {grouped.recruiting.length === 0 ? <div style={{ opacity: 0.8 }}>No recruiting circles.</div> : null}
          {grouped.recruiting.map((c) => (
            <Link
              key={c.circle_id}
              to={`/circle/${c.circle_id}`}
              style={{ display: "block", padding: 12, borderRadius: 12, border: "1px solid rgba(255,255,255,0.2)" }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <div style={{ fontWeight: 700 }}>{c.name ?? c.circle_id}</div>
                <StatusBadge status={c.status} />
              </div>
              <div style={{ opacity: 0.85, fontSize: 13 }}>
                N={c.n_members} · C={formatUsdt(BigInt(c.contribution_units))} USDT
              </div>
            </Link>
          ))}
        </section>

        <section style={{ display: "grid", gap: 8 }}>
          <h2 style={{ fontSize: 16, margin: 0 }}>Past Circles</h2>
          {grouped.past.length === 0 ? <div style={{ opacity: 0.8 }}>No past circles.</div> : null}
          {grouped.past.map((c) => (
            <Link
              key={c.circle_id}
              to={`/circle/${c.circle_id}`}
              style={{ display: "block", padding: 12, borderRadius: 12, border: "1px solid rgba(255,255,255,0.2)" }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <div style={{ fontWeight: 700 }}>{c.name ?? c.circle_id}</div>
                <StatusBadge status={c.status} />
              </div>
              <div style={{ opacity: 0.85, fontSize: 13 }}>
                N={c.n_members} · C={formatUsdt(BigInt(c.contribution_units))} USDT
              </div>
            </Link>
          ))}
        </section>
      </div>
    </Page>
  );
}
