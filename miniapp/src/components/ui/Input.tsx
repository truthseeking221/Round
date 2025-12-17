import * as React from "react";

import { cn } from "../../lib/cn";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref
) {
  return (
    <input
      ref={ref}
      className={cn(
        "h-11 w-full rounded-xl bg-slate-950/60 px-3 text-sm text-slate-50 ring-1 ring-slate-800 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500",
        className
      )}
      {...props}
    />
  );
});

