import * as React from "react";
import { cn } from "../../lib/cn";

export type ButtonVariant = "default" | "secondary" | "ghost" | "danger" | "success" | "outline" | "link";
export type ButtonSize = "sm" | "md" | "lg" | "icon";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  asChild?: boolean;
}

const buttonVariants = (variant: ButtonVariant, size: ButtonSize, className?: string) => {
  const base = "inline-flex items-center justify-center whitespace-nowrap rounded-xl text-sm font-medium ring-offset-slate-950 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98]";
  
  const variants: Record<ButtonVariant, string> = {
    default: "bg-blue-600 text-slate-50 hover:bg-blue-500 shadow-lg shadow-blue-900/20 border border-blue-500/20",
    secondary: "bg-slate-800 text-slate-100 hover:bg-slate-700 border border-slate-700/50",
    danger: "bg-red-600 text-slate-50 hover:bg-red-500 shadow-lg shadow-red-900/20 border border-red-500/20",
    success: "bg-emerald-600 text-slate-50 hover:bg-emerald-500 shadow-lg shadow-emerald-900/20 border border-emerald-500/20",
    outline: "border border-slate-700 bg-transparent hover:bg-slate-800 text-slate-300 hover:text-slate-100",
    ghost: "hover:bg-slate-800 hover:text-slate-100 text-slate-400",
    link: "text-blue-400 underline-offset-4 hover:underline",
  };

  const sizes: Record<ButtonSize, string> = {
    sm: "h-9 px-3 text-xs",
    md: "h-11 px-4 py-2",
    lg: "h-14 px-8 text-base",
    icon: "h-10 w-10",
  };

  return cn(base, variants[variant], sizes[size], className);
};

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "md", loading = false, children, disabled, ...props }, ref) => {
    return (
      <button
        className={buttonVariants(variant, size, className)}
        ref={ref}
        disabled={disabled || loading}
        {...props}
      >
        {loading && (
          <svg className="mr-2 h-4 w-4 animate-spin" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        )}
        {children}
      </button>
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };