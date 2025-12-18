import { cn } from "../../lib/cn";
import { type ReactNode } from "react";

// ============================================
// BADGE COMPONENT - Status indicators
// ============================================

export type BadgeVariant = 
  | "default" 
  | "secondary"
  | "success" 
  | "warning" 
  | "error" 
  | "outline"
  | "recruiting"
  | "active"
  | "completed"
  | "terminated";

export interface BadgeProps {
  children: ReactNode;
  variant?: BadgeVariant;
  className?: string;
  icon?: ReactNode;
  pulse?: boolean;
}

const variantStyles: Record<BadgeVariant, string> = {
  default: "bg-slate-800/80 text-slate-300 border-slate-700/50",
  secondary: "bg-slate-800/50 text-slate-400 border-slate-700/30",
  success: "bg-emerald-950/50 text-emerald-400 border-emerald-800/50",
  warning: "bg-amber-950/50 text-amber-400 border-amber-800/50",
  error: "bg-red-950/50 text-red-400 border-red-800/50",
  outline: "bg-transparent text-slate-400 border-slate-600",
  // Status-specific variants
  recruiting: "bg-blue-950/50 text-blue-400 border-blue-800/50",
  active: "bg-emerald-950/50 text-emerald-400 border-emerald-800/50",
  completed: "bg-slate-800/50 text-slate-300 border-slate-700/50",
  terminated: "bg-red-950/50 text-red-400 border-red-800/50",
};

export function Badge({ 
  children, 
  variant = "default", 
  className, 
  icon,
  pulse = false 
}: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5",
        "px-2.5 py-1 rounded-full",
        "text-xs font-medium",
        "border backdrop-blur-sm",
        "transition-colors duration-200",
        variantStyles[variant],
        className
      )}
    >
      {icon && (
        <span className={cn("w-3.5 h-3.5 flex items-center justify-center", pulse && "animate-pulse")}>
          {icon}
        </span>
      )}
      {children}
    </span>
  );
}

// ============================================
// STATUS DOT - Small inline indicator
// ============================================

export interface StatusDotProps {
  status: "active" | "pending" | "error" | "offline";
  className?: string;
  pulse?: boolean;
}

export function StatusDot({ status, className, pulse = false }: StatusDotProps) {
  const colors = {
    active: "bg-emerald-500",
    pending: "bg-amber-500",
    error: "bg-red-500",
    offline: "bg-slate-500",
  };

  return (
    <span
      className={cn(
        "inline-block w-2 h-2 rounded-full",
        colors[status],
        pulse && "animate-pulse",
        className
      )}
      style={{
        boxShadow: status !== "offline" ? `0 0 8px ${colors[status].replace("bg-", "rgb(var(--")}` : undefined,
      }}
    />
  );
}

// ============================================
// SECURE BADGE - Trust indicator
// ============================================

export function SecureBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium",
        "bg-emerald-950/30 text-emerald-400 border border-emerald-800/30",
        className
      )}
    >
      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
      </svg>
      Secured
    </span>
  );
}

// (status variant helper moved to `badgeVariants.ts`)
