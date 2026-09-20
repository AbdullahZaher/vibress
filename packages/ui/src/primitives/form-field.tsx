import * as React from "react";
import { cn } from "../utils";
import { Label } from "./label";

export interface FormFieldProps extends React.HTMLAttributes<HTMLDivElement> {
  label?: string | undefined;
  htmlFor?: string | undefined;
  required?: boolean | undefined;
  error?: string | null | undefined;
  description?: string | null | undefined;
}

const FormField = React.forwardRef<HTMLDivElement, FormFieldProps>(
  ({ className, label, htmlFor, required, error, description, children, ...props }, ref) => {
    return (
      <div ref={ref} className={cn("space-y-1.5 text-start", className)} {...props}>
        {label && (
          <Label htmlFor={htmlFor} required={required}>
            {label}
          </Label>
        )}
        {children}
        {description && !error && (
          <p className="text-[11px] text-muted-foreground leading-relaxed">{description}</p>
        )}
        {error && (
          <p role="alert" className="text-xs font-medium text-destructive leading-tight animate-in fade-in-50 duration-150">
            {error}
          </p>
        )}
      </div>
    );
  },
);
FormField.displayName = "FormField";

export { FormField };
