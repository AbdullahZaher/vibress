import * as React from "react";
import { cn } from "@/lib/utils";

export interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center p-8 sm:p-12 text-center rounded-xl border border-dashed border-border/80 bg-muted/20",
        className,
      )}
      {...props}
    >
      {icon && (
        <div className="size-12 rounded-2xl bg-muted/60 text-muted-foreground flex items-center justify-center mb-3 border border-border/40 shadow-2xs">
          {icon}
        </div>
      )}
      <h4 className="text-sm sm:text-base font-semibold text-foreground tracking-tight mb-1">
        {title}
      </h4>
      {description && (
        <p className="text-xs sm:text-sm text-muted-foreground max-w-sm leading-relaxed mb-4">
          {description}
        </p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
