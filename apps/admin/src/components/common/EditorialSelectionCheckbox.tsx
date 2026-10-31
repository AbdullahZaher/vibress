import React, { useEffect, useRef } from "react";
import { Check, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

export interface EditorialSelectionCheckboxProps {
  checked: boolean;
  indeterminate?: boolean | undefined;
  onChange: (checked: boolean) => void;
  label: string;
  showLabel?: boolean | undefined;
  disabled?: boolean | undefined;
  className?: string | undefined;
  boxClassName?: string | undefined;
  id?: string | undefined;
}

/**
 * Shared minimal, theme-aware selection checkbox for Vibress Admin.
 * Replaces white floating cards and shadows with a clean, token-integrated box.
 * Satisfies WCAG 2.2 AA (44px touch target, visible focus, aria-checked support).
 */
export const EditorialSelectionCheckbox: React.FC<EditorialSelectionCheckboxProps> = ({
  checked,
  indeterminate = false,
  onChange,
  label,
  showLabel = false,
  disabled = false,
  className,
  boxClassName,
  id,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.indeterminate = Boolean(indeterminate);
    }
  }, [indeterminate]);

  return (
    <label
      htmlFor={id}
      className={cn(
        "group/cb relative inline-flex min-h-11 cursor-pointer select-none items-center",
        !showLabel && "min-w-11 justify-center",
        disabled && "cursor-not-allowed opacity-50",
        className
      )}
    >
      <span className="relative flex size-[18px] shrink-0 items-center justify-center">
        <input
          ref={inputRef}
          id={id}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          aria-label={label}
          onChange={(event) => onChange(event.target.checked)}
          className={cn(
            "size-[18px] cursor-pointer appearance-none rounded-[5px] border transition-all duration-150",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            checked || indeterminate
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border/80 bg-background/40 hover:border-foreground/50 hover:bg-muted/30 dark:bg-background/20",
            boxClassName
          )}
        />
        {(checked || indeterminate) && (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-primary-foreground">
            {indeterminate ? (
              <Minus className="size-3.5 stroke-[2.75]" aria-hidden="true" />
            ) : (
              <Check className="size-3.5 stroke-[2.75]" aria-hidden="true" />
            )}
          </span>
        )}
      </span>
      {showLabel && (
        <span className="ms-2.5 text-sm font-medium text-muted-foreground transition-colors group-hover/cb:text-foreground">
          {label}
        </span>
      )}
    </label>
  );
};
