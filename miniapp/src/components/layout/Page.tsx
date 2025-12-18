import * as React from "react";
import { Link } from "react-router-dom";
import { cn } from "../../lib/cn";

// ============================================
// PAGE LAYOUT COMPONENT
// ============================================

export interface PageProps {
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
  headerAction?: React.ReactNode;
  leading?: React.ReactNode;
  showHeader?: boolean;
  maxWidth?: "sm" | "md" | "lg" | "xl" | "full";
  bottomDock?: React.ReactNode;
}

const maxWidthClasses = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-xl",
  full: "max-w-full",
};

export function Page({
  title,
  subtitle,
  children,
  className,
  headerAction,
  leading,
  showHeader = true,
  maxWidth = "xl",
  bottomDock,
}: PageProps) {
  const hasBottomDock = Boolean(bottomDock);

  return (
    <div className="min-h-screen flex flex-col">
      {/* Background gradient effects */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-blue-600/5 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-emerald-600/5 rounded-full blur-3xl" />
      </div>

      <div className={cn("relative z-10 flex-1", className)}>
        {/* Top bar */}
        {showHeader ? (
          <header className="sticky top-0 z-20 pt-safe">
            <div
              className={cn(
                "bg-slate-950/65 backdrop-blur-xl",
                "border-b border-slate-800/60"
              )}
            >
              <div className="px-4">
                <div className={cn("mx-auto w-full", maxWidthClasses[maxWidth])}>
                  <div className="flex items-center gap-3 py-3">
                    {leading ? <div className="shrink-0">{leading}</div> : null}
                    <div className="min-w-0 flex-1">
                      {title ? (
                        <h1 className="text-[17px] font-semibold text-slate-50 tracking-tight leading-tight">
                          {title}
                        </h1>
                      ) : null}
                      {subtitle ? (
                        <p className="mt-0.5 text-xs text-slate-400">{subtitle}</p>
                      ) : null}
                    </div>
                    {headerAction ? <div className="shrink-0">{headerAction}</div> : null}
                  </div>
                </div>
              </div>
              <div className="h-px bg-gradient-to-r from-transparent via-slate-700/60 to-transparent" />
            </div>
          </header>
        ) : null}

        {/* Main content */}
        <div className={cn("px-4 py-6", hasBottomDock ? "pb-dock" : "pb-safe")}>
          <div className={cn("mx-auto w-full", maxWidthClasses[maxWidth])}>
            <main>{children}</main>
          </div>
        </div>

        {/* Bottom dock */}
        {hasBottomDock ? (
          <div className="fixed inset-x-0 bottom-0 z-30">
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-slate-950/90 via-slate-950/60 to-transparent" />
            <div className="relative px-4 pb-safe pt-3">
              <div className={cn("mx-auto w-full", maxWidthClasses[maxWidth])}>
                <div className="pointer-events-auto rounded-2xl border border-slate-800/60 bg-slate-950/55 backdrop-blur-xl shadow-lg shadow-black/30 p-2">
                  {bottomDock}
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ============================================
// SECTION COMPONENT - For grouping content
// ============================================

export interface SectionProps {
  title?: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
  action?: React.ReactNode;
}

export function Section({ title, description, children, className, action }: SectionProps) {
  return (
    <section className={cn("space-y-4", className)}>
      {(title || description) && (
        <div className="flex items-start justify-between gap-4">
          <div>
            {title && (
              <h2 className="text-lg font-semibold text-slate-100">{title}</h2>
            )}
            {description && (
              <p className="mt-0.5 text-sm text-slate-400">{description}</p>
            )}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

// ============================================
// DIVIDER COMPONENT
// ============================================

export function Divider({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "h-px w-full",
        "bg-gradient-to-r from-transparent via-slate-700/50 to-transparent",
        className
      )}
    />
  );
}

// ============================================
// BACK LINK COMPONENT
// ============================================

export interface BackLinkProps {
  to: string;
  label?: string;
  className?: string;
}

export function BackLink({ to, label = "Back", className }: BackLinkProps) {
  return (
    <Link
      to={to}
      className={cn(
        "inline-flex items-center gap-1.5 text-sm text-slate-400",
        "hover:text-slate-100 transition-colors duration-200",
        className
      )}
    >
      <svg
        className="w-4 h-4"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M15 19l-7-7 7-7"
        />
      </svg>
      {label}
    </Link>
  );
}

// ============================================
// EMPTY STATE COMPONENT
// ============================================

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center py-12 px-6 text-center",
        className
      )}
    >
      {icon && (
        <div className="mb-4 text-slate-600">{icon}</div>
      )}
      <h3 className="text-lg font-medium text-slate-300">{title}</h3>
      {description && (
        <p className="mt-2 text-sm text-slate-500 max-w-sm">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

// ============================================
// LOADING STATE COMPONENT
// ============================================

export function LoadingState({ message = "Loading..." }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12">
      <div className="relative w-10 h-10">
        <div className="absolute inset-0 rounded-full border-2 border-slate-700" />
        <div className="absolute inset-0 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
      </div>
      <p className="mt-4 text-sm text-slate-400">{message}</p>
    </div>
  );
}
