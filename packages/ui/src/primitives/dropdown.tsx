import * as React from "react";
import { cn } from "../utils";

export interface DropdownItemProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: React.ReactNode;
  destructive?: boolean;
}

export const DropdownItem = React.forwardRef<
  HTMLButtonElement,
  DropdownItemProps
>(({ className, icon, destructive, children, ...props }, ref) => {
  return (
    <button
      ref={ref}
      type="button"
      className={cn(
        "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-xs text-start font-medium transition-colors cursor-pointer select-none",
        destructive
          ? "text-destructive hover:bg-destructive/10"
          : "text-foreground hover:bg-muted/80 hover:text-foreground",
        className,
      )}
      {...props}
    >
      {icon && <span className="size-4 shrink-0 text-muted-foreground">{icon}</span>}
      <span className="flex-1 truncate">{children}</span>
    </button>
  );
});
DropdownItem.displayName = "DropdownItem";

export function DropdownSeparator({ className }: { className?: string }) {
  return <div className={cn("my-1 h-px bg-border/60 -mx-1", className)} />;
}
