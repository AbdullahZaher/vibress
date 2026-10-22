import * as React from "react";
import { createPortal } from "react-dom";
import { Button, type ButtonProps } from "./button";

export interface IconButtonProps extends Omit<ButtonProps, "size" | "title"> {
  /** Localized tooltip and default screen-reader name. */
  label: string;
  /** Optional item-specific accessible name, e.g. "Edit: My post". */
  accessibleLabel?: string;
  size?: "icon" | "icon-sm";
}

/** Compact secondary action with an unclipped hover and focus tooltip. */
export function IconButton({
  label, accessibleLabel, size = "icon", className, disabled,
  onFocus, onBlur, onMouseEnter, onMouseLeave, children, ...props
}: IconButtonProps) {
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const [position, setPosition] = React.useState<{
    left: number; top: number; above: boolean;
  } | null>(null);

  const show = () => {
    if (disabled || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const above = rect.top >= 48;
    setPosition({
      left: Math.max(16, Math.min(window.innerWidth - 16, rect.left + rect.width / 2)),
      top: above ? rect.top - 8 : rect.bottom + 8,
      above,
    });
  };
  const hide = () => setPosition(null);

  React.useEffect(() => {
    if (!position) return;
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [position]);

  React.useEffect(() => {
    if (disabled) hide();
  }, [disabled]);

  return (
    <>
      <Button
        {...props}
        ref={buttonRef}
        type={props.type ?? "button"}
        variant={props.variant ?? "ghost"}
        size={size}
        disabled={disabled}
        aria-label={accessibleLabel ?? label}
        className={`min-h-9 min-w-9 ${className ?? ""}`}
        onFocus={(event) => { show(); onFocus?.(event); }}
        onBlur={(event) => { hide(); onBlur?.(event); }}
        onMouseEnter={(event) => { show(); onMouseEnter?.(event); }}
        onMouseLeave={(event) => { hide(); onMouseLeave?.(event); }}
      >
        {children}
      </Button>
      {position && typeof document !== "undefined" && createPortal(
        <span
          aria-hidden="true"
          dir="auto"
          className="pointer-events-none fixed z-[9999] max-w-[min(18rem,calc(100vw-1rem))] rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs font-medium text-popover-foreground shadow-md"
          style={{
            left: position.left,
            top: position.top,
            transform: position.above ? "translate(-50%, -100%)" : "translateX(-50%)",
          }}
        >
          {label}
        </span>,
        document.body,
      )}
    </>
  );
}
