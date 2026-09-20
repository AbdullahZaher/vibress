import * as React from "react";
import { cn } from "../utils";

export interface SpinnerProps extends React.HTMLAttributes<HTMLSpanElement> {
  size?: "xs" | "sm" | "md" | "lg";
  label?: string;
}

export function Spinner({
  size = "md",
  label = "Loading",
  className,
  ...props
}: SpinnerProps) {
  const sizeClasses = {
    xs: "size-3 border-2",
    sm: "size-4 border-2",
    md: "size-6 border-2",
    lg: "size-8 border-3",
  };

  return (
    <span
      className={cn(
        "inline-block animate-spin rounded-full border-primary border-t-transparent shrink-0",
        sizeClasses[size],
        className,
      )}
      role="status"
      aria-label={label}
      {...props}
    >
      <span className="sr-only">{label}</span>
    </span>
  );
}
