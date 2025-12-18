import { Card, CardContent, CardHeader, CardTitle } from "../ui/Card";
import { Badge } from "../ui/Badge";
import { cn } from "../../lib/cn";

// ============================================
// SCHEDULE ITEM COMPONENT
// ============================================

interface ScheduleItemProps {
  label: string;
  time: string | null | undefined;
  isPast: boolean;
  isActive: boolean;
  isNext: boolean;
}

function ScheduleItem({ label, time, isPast, isActive, isNext }: ScheduleItemProps) {
  if (!time) return null;

  const d = new Date(time);
  const isValid = Number.isFinite(d.getTime());
  const displayTime = isValid
    ? d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : "Pending";

  return (
    <div
      className={cn(
        "relative pl-6 pb-4 border-l-2 last:border-l-0 last:pb-0",
        isPast ? "border-slate-800" : isActive || isNext ? "border-blue-600/50" : "border-slate-800"
      )}
    >
      {/* Timeline dot */}
      <div
        className={cn(
          "absolute left-[-5px] top-0.5 w-2 h-2 rounded-full",
          isActive
            ? "bg-blue-500 shadow-lg shadow-blue-500/50 animate-pulse"
            : isPast
            ? "bg-slate-700"
            : isNext
            ? "bg-blue-500/50"
            : "bg-slate-800"
        )}
      />

      <div className="flex justify-between items-start gap-2">
        <span
          className={cn(
            "text-xs font-medium",
            isActive ? "text-blue-400" : isPast ? "text-slate-600" : "text-slate-400"
          )}
        >
          {label}
        </span>
        <span
          className={cn(
            "text-xs font-mono tabular-nums",
            isActive ? "text-slate-100 font-semibold" : isPast ? "text-slate-600" : "text-slate-300"
          )}
        >
          {displayTime}
        </span>
      </div>
    </div>
  );
}

// ============================================
// PHASE NAMES
// ============================================

const phaseNames: Record<number, string> = {
  0: "Funding",
  1: "Commit",
  2: "Reveal",
  3: "Default Eligible",
};

// ============================================
// ON-CHAIN SCHEDULE CARD
// ============================================

interface OnChainScheduleCardProps {
  circle: {
    onchain_due_at?: string | null;
    onchain_grace_end_at?: string | null;
    onchain_commit_end_at?: string | null;
    onchain_reveal_end_at?: string | null;
    onchain_phase?: number | null;
    onchain_funded_count?: number | null;
    n_members?: number;
  };
  nowMs?: number;
}

export function OnChainScheduleCard({ circle, nowMs }: OnChainScheduleCardProps) {
  const now = nowMs ?? 0;

  const getStatus = (timeStr?: string | null, nextTimeStr?: string | null) => {
    if (!timeStr) return { isPast: false, isActive: false, isNext: false };
    const t = new Date(timeStr).getTime();
    const isPast = now > t;
    const nextT = nextTimeStr ? new Date(nextTimeStr).getTime() : Infinity;
    const isActive = !isPast && now <= t && now > t - 3600000; // Active if within 1 hour before
    const isNext = !isPast && !isActive && (nextTimeStr ? now > nextT : false);
    return { isPast, isActive, isNext };
  };

  const phase = circle.onchain_phase;
  const phaseName = phase !== null && phase !== undefined ? phaseNames[phase] ?? `Phase ${phase}` : "—";

  const hasSchedule = circle.onchain_due_at || circle.onchain_grace_end_at || circle.onchain_commit_end_at || circle.onchain_reveal_end_at;

  if (!hasSchedule) {
    return null;
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">Round Schedule</CardTitle>
          <Badge variant="secondary" className="font-mono text-[10px]">
            {phaseName}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="space-y-0">
          <ScheduleItem
            label="Due Date"
            time={circle.onchain_due_at}
            {...getStatus(circle.onchain_due_at, circle.onchain_grace_end_at)}
          />
          <ScheduleItem
            label="Grace Period End"
            time={circle.onchain_grace_end_at}
            {...getStatus(circle.onchain_grace_end_at, circle.onchain_commit_end_at)}
          />
          <ScheduleItem
            label="Commit End"
            time={circle.onchain_commit_end_at}
            {...getStatus(circle.onchain_commit_end_at, circle.onchain_reveal_end_at)}
          />
          <ScheduleItem
            label="Reveal End"
            time={circle.onchain_reveal_end_at}
            {...getStatus(circle.onchain_reveal_end_at)}
          />
        </div>

        {/* Funded count */}
        {circle.onchain_funded_count !== undefined && circle.onchain_funded_count !== null && (
          <div className="mt-4 pt-3 border-t border-slate-800/50 flex justify-between items-center text-xs">
            <span className="text-slate-500">Funded Members</span>
            <span className="text-emerald-400 font-semibold font-mono">
              {circle.onchain_funded_count}
              {circle.n_members ? ` / ${circle.n_members}` : ""}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
