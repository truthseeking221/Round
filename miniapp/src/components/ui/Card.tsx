import * as React from "react";
import { cn } from "../../lib/cn";

// ============================================
// CARD COMPONENTS - Vault-style secure design
// ============================================

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "elevated" | "interactive" | "vault";
}

export function Card({ className, variant = "default", ...props }: CardProps) {
  const variants = {
    default: "card",
    elevated: "card-elevated",
    interactive: "card-interactive",
    vault: "vault-card",
  };

  return (
    <div
      className={cn(
        // Base card styles
        "relative overflow-hidden rounded-2xl",
        "bg-slate-900/90 backdrop-blur-md",
        "border border-slate-800/60",
        "shadow-lg shadow-black/20",
        variants[variant],
        className
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex flex-col gap-1.5 p-5 pb-3", className)}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn(
        "text-lg font-semibold leading-tight tracking-tight text-slate-50",
        className
      )}
      {...props}
    />
  );
}

export function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={cn("text-sm text-slate-400 leading-relaxed", className)}
      {...props}
    />
  );
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("p-5 pt-0", className)} {...props} />
  );
}

export function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 p-5 pt-3",
        "border-t border-slate-800/50",
        className
      )}
      {...props}
    />
  );
}

// ============================================
// STAT CARD - For displaying metrics
// ============================================

export interface StatCardProps {
  label: string;
  value: string | React.ReactNode;
  subValue?: string;
  icon?: React.ReactNode;
  trend?: "up" | "down" | "neutral";
  className?: string;
}

export function StatCard({ label, value, subValue, icon, trend, className }: StatCardProps) {
  const trendColors = {
    up: "text-emerald-400",
    down: "text-red-400",
    neutral: "text-slate-400",
  };

  return (
    <div
      className={cn(
        "relative p-4 rounded-xl",
        "bg-slate-900/60 border border-slate-800/40",
        "transition-all duration-200",
        "hover:bg-slate-900/80 hover:border-slate-700/50",
        className
      )}
    >
      {/* Label */}
      <div className="flex items-center gap-2 mb-2">
        {icon && (
          <span className="text-slate-500">{icon}</span>
        )}
        <span className="text-xs font-medium uppercase tracking-wider text-slate-500">
          {label}
        </span>
      </div>

      {/* Value */}
      <div className="text-xl font-semibold text-slate-100 font-mono-safe">
        {value}
      </div>

      {/* Sub value with optional trend */}
      {subValue && (
        <div className={cn("text-xs mt-1", trend ? trendColors[trend] : "text-slate-500")}>
          {subValue}
        </div>
      )}
    </div>
  );
}

// ============================================
// ALERT CARD - For warnings and notices
// ============================================

export interface AlertCardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "info" | "warning" | "error" | "success";
  title?: string;
  icon?: React.ReactNode;
}

export function AlertCard({ 
  variant = "info", 
  title, 
  icon, 
  children, 
  className, 
  ...props 
}: AlertCardProps) {
  const variants = {
    info: {
      bg: "bg-blue-950/30 border-blue-800/40",
      icon: "text-blue-400",
      title: "text-blue-300",
    },
    warning: {
      bg: "bg-amber-950/30 border-amber-800/40",
      icon: "text-amber-400",
      title: "text-amber-300",
    },
    error: {
      bg: "bg-red-950/30 border-red-800/40",
      icon: "text-red-400",
      title: "text-red-300",
    },
    success: {
      bg: "bg-emerald-950/30 border-emerald-800/40",
      icon: "text-emerald-400",
      title: "text-emerald-300",
    },
  };

  const styles = variants[variant];

  const defaultIcons = {
    info: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    warning: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
    ),
    error: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    success: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  };

  return (
    <div
      className={cn(
        "flex gap-3 p-4 rounded-xl border",
        styles.bg,
        className
      )}
      {...props}
    >
      <span className={cn("shrink-0 mt-0.5", styles.icon)}>
        {icon || defaultIcons[variant]}
      </span>
      <div className="flex-1 min-w-0">
        {title && (
          <div className={cn("font-medium mb-1", styles.title)}>
            {title}
          </div>
        )}
        <div className="text-sm text-slate-300">{children}</div>
      </div>
    </div>
  );
}
