import { cn } from "../../lib/cn";

export function Badge(props: { children: string; variant?: "default" | "good" | "warn" | "bad"; className?: string }) {
  const v = props.variant ?? "default";
  const styles: Record<string, string> = {
    default: "bg-slate-800 text-slate-200 ring-slate-700",
    good: "bg-emerald-500/20 text-emerald-200 ring-emerald-500/30",
    warn: "bg-amber-500/20 text-amber-200 ring-amber-500/30",
    bad: "bg-rose-500/20 text-rose-200 ring-rose-500/30"
  };
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-1 text-xs ring-1", styles[v], props.className)}>
      {props.children}
    </span>
  );
}

