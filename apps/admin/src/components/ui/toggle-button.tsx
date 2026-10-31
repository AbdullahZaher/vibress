import * as React from "react";
import { cn } from "@/lib/utils";
import { Button, type ButtonProps } from "./button";

/** Compact mutually-selectable filter, never a substitute for a navigation link or tab panel. */
export interface ToggleButtonProps extends Omit<ButtonProps, "variant" | "aria-pressed"> {
  pressed: boolean;
}

export const ToggleButton = React.forwardRef<HTMLButtonElement, ToggleButtonProps>(
  ({ pressed, className, size = "sm", ...props }, ref) => (
    <Button
      {...props}
      ref={ref}
      type={props.type ?? "button"}
      size={size}
      variant={pressed ? "subtle" : "ghost"}
      aria-pressed={pressed}
      className={cn("min-h-11 shrink-0 px-3.5", pressed && "font-semibold", className)}
    />
  ),
);
ToggleButton.displayName = "ToggleButton";
