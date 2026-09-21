import * as React from "react";
import { cn } from "@/lib/utils";
import { Check } from "lucide-react";

export interface CheckboxProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  onCheckedChange?: (checked: boolean) => void;
}

const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, checked, disabled, onChange, onCheckedChange, ...props }, ref) => {
    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange?.(e);
      onCheckedChange?.(e.target.checked);
    };

    return (
      <label
        className={cn(
          "relative inline-flex items-center justify-center size-4 shrink-0 rounded border cursor-pointer select-none transition-all",
          checked
            ? "bg-primary border-primary text-primary-foreground shadow-2xs"
            : "border-border/80 bg-background hover:border-primary/50",
          disabled && "cursor-not-allowed opacity-50",
          className,
        )}
      >
        <input
          type="checkbox"
          ref={ref}
          checked={checked}
          disabled={disabled}
          onChange={handleChange}
          className="sr-only"
          {...props}
        />
        {checked && <Check className="size-3 stroke-[3]" />}
      </label>
    );
  },
);
Checkbox.displayName = "Checkbox";

export { Checkbox };
