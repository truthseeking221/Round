import * as React from "react";
import { cn } from "../../lib/cn";

// ============================================
// INPUT COMPONENT
// ============================================

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
  icon?: React.ReactNode;
  iconPosition?: "left" | "right";
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  function Input(
    { className, label, error, hint, icon, iconPosition = "left", type, ...props },
    ref
  ) {
    const hasError = Boolean(error);

    return (
      <div className="w-full">
        {/* Label */}
        {label && (
          <label className="block text-xs font-medium uppercase tracking-wider text-slate-400 mb-2">
            {label}
          </label>
        )}

        {/* Input wrapper */}
        <div className="relative">
          {/* Icon left */}
          {icon && iconPosition === "left" && (
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">
              {icon}
            </span>
          )}

          <input
            type={type}
            ref={ref}
            className={cn(
              // Base styles
              "w-full h-11 rounded-xl",
              "bg-slate-950/60 backdrop-blur-sm",
              "border transition-all duration-200",
              "text-sm text-slate-100 placeholder:text-slate-500",
              "focus:outline-none",
              // Padding based on icon
              icon && iconPosition === "left" ? "pl-10 pr-4" : "px-4",
              icon && iconPosition === "right" ? "pr-10 pl-4" : "px-4",
              // Border states
              hasError
                ? "border-red-800/60 focus:border-red-600 focus:ring-2 focus:ring-red-900/30"
                : "border-slate-800 focus:border-blue-600 focus:ring-2 focus:ring-blue-900/30",
              // Disabled
              "disabled:opacity-50 disabled:cursor-not-allowed",
              className
            )}
            {...props}
          />

          {/* Icon right */}
          {icon && iconPosition === "right" && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500">
              {icon}
            </span>
          )}
        </div>

        {/* Error message */}
        {error && (
          <p className="mt-1.5 text-xs text-red-400 flex items-center gap-1">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {error}
          </p>
        )}

        {/* Hint text */}
        {hint && !error && (
          <p className="mt-1.5 text-xs text-slate-500">{hint}</p>
        )}
      </div>
    );
  }
);

// ============================================
// TEXTAREA COMPONENT
// ============================================

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  hint?: string;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea({ className, label, error, hint, ...props }, ref) {
    const hasError = Boolean(error);

    return (
      <div className="w-full">
        {label && (
          <label className="block text-xs font-medium uppercase tracking-wider text-slate-400 mb-2">
            {label}
          </label>
        )}

        <textarea
          ref={ref}
          className={cn(
            "w-full min-h-[100px] rounded-xl px-4 py-3",
            "bg-slate-950/60 backdrop-blur-sm",
            "border transition-all duration-200",
            "text-sm text-slate-100 placeholder:text-slate-500",
            "focus:outline-none resize-y",
            hasError
              ? "border-red-800/60 focus:border-red-600 focus:ring-2 focus:ring-red-900/30"
              : "border-slate-800 focus:border-blue-600 focus:ring-2 focus:ring-blue-900/30",
            "disabled:opacity-50 disabled:cursor-not-allowed",
            className
          )}
          {...props}
        />

        {error && (
          <p className="mt-1.5 text-xs text-red-400 flex items-center gap-1">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {error}
          </p>
        )}

        {hint && !error && (
          <p className="mt-1.5 text-xs text-slate-500">{hint}</p>
        )}
      </div>
    );
  }
);

// ============================================
// SELECT COMPONENT
// ============================================

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  hint?: string;
  options: Array<{ value: string; label: string }>;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  function Select({ className, label, error, hint, options, ...props }, ref) {
    const hasError = Boolean(error);

    return (
      <div className="w-full">
        {label && (
          <label className="block text-xs font-medium uppercase tracking-wider text-slate-400 mb-2">
            {label}
          </label>
        )}

        <select
          ref={ref}
          className={cn(
            "w-full h-11 rounded-xl px-4",
            "bg-slate-950/60 backdrop-blur-sm",
            "border transition-all duration-200",
            "text-sm text-slate-100",
            "focus:outline-none",
            hasError
              ? "border-red-800/60 focus:border-red-600 focus:ring-2 focus:ring-red-900/30"
              : "border-slate-800 focus:border-blue-600 focus:ring-2 focus:ring-blue-900/30",
            "disabled:opacity-50 disabled:cursor-not-allowed",
            className
          )}
          {...props}
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        {error && (
          <p className="mt-1.5 text-xs text-red-400">{error}</p>
        )}

        {hint && !error && (
          <p className="mt-1.5 text-xs text-slate-500">{hint}</p>
        )}
      </div>
    );
  }
);
