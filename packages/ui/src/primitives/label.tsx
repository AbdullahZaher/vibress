import * as React from "react";
import { cn } from "../utils";

export interface LabelProps
  extends React.LabelHTMLAttributes<HTMLLabelElement> {
  required?: boolean | undefined;
}

const Label = React.forwardRef<HTMLLabelElement, LabelProps>(
  ({ className, required, children, ...props }, ref) => {
    return (
      <label
        ref={ref}
        className={cn(
          "text-xs font-medium text-foreground leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 select-none",
          className,
        )}
        {...props}
      >
        {children}
        {required && <span className="text-destructive ms-1">*</span>}
      </label>
    );
  },
);
Label.displayName = "Label";

export { Label };
