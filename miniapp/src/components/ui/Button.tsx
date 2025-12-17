import * as React from "react";

import { cn } from "../../lib/cn";

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
};

export function Button({ className, variant = "primary", ...props }: ButtonProps) {
  const base =
    "inline-flex h-11 w-full items-center justify-center rounded-xl px-4 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50";
  const variants: Record<string, string> = {
    primary: "bg-sky-500 text-white hover:bg-sky-400",
    secondary: "bg-slate-800 text-slate-100 hover:bg-slate-700",
    ghost: "bg-transparent text-slate-200 ring-1 ring-slate-800 hover:bg-slate-900/60",
    danger: "bg-rose-500 text-white hover:bg-rose-400"
  };
  return <button className={cn(base, variants[variant], className)} {...props} />;
}

