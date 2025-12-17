import { Card, CardTitle } from "../ui/Card";

function fmtIso(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleString();
}

export function OnChainScheduleCard(props: {
  circle: {
    onchain_due_at?: string | null;
    onchain_grace_end_at?: string | null;
    onchain_commit_end_at?: string | null;
    onchain_reveal_end_at?: string | null;
    onchain_phase?: number | null;
    onchain_funded_count?: number | null;
  };
}) {
  const c = props.circle;
  return (
    <Card>
      <CardTitle>On-chain Schedule</CardTitle>
      <div className="mt-3 space-y-1 text-sm text-slate-200">
        <div>Due time: {fmtIso(c.onchain_due_at)}</div>
        <div>Grace ends: {fmtIso(c.onchain_grace_end_at)}</div>
        <div>Commit ends: {fmtIso(c.onchain_commit_end_at)}</div>
        <div>Reveal ends: {fmtIso(c.onchain_reveal_end_at)}</div>
        <div className="mt-2 text-xs text-slate-400">
          Phase: {c.onchain_phase ?? "—"} · Funded: {c.onchain_funded_count ?? "—"}
        </div>
      </div>
    </Card>
  );
}
