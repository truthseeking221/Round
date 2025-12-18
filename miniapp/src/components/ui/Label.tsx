import * as React from "react";
import { cn } from "../../lib/cn";

const Label = React.forwardRef<
  HTMLLabelElement,
  React.LabelHTMLAttributes<HTMLLabelElement>
>(({ className, ...props }, ref) => (
  <label
    ref={ref}
    className={cn(
      "text-xs font-bold uppercase tracking-wider text-slate-400 peer-disabled:cursor-not-allowed peer-disabled:opacity-70 mb-1.5 block",
      className
    )}
    {...props}
  />
));
Label.displayName = "Label";

export { Label };