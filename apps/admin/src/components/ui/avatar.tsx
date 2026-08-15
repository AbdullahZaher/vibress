import * as React from "react";
import { cn } from "@/lib/utils";

export function Avatar({
  src,
  alt,
  fallback,
  className,
  size = "md",
}: {
  src?: string;
  alt?: string;
  fallback: string;
  className?: string;
  size?: "sm" | "md" | "lg";
}) {
  const [hasError, setHasError] = React.useState(false);

  const sizeClasses = {
    sm: "h-7 w-7 text-xs",
    md: "h-9 w-9 text-sm",
    lg: "h-12 w-12 text-base",
  };

  return (
    <div
      className={cn(
        "relative flex shrink-0 overflow-hidden rounded-full border bg-muted font-semibold justify-center items-center text-muted-foreground select-none",
        sizeClasses[size],
        className,
      )}
    >
      {src && !hasError ? (
        <img
          src={src}
          alt={alt || fallback}
          onError={() => setHasError(true)}
          className="aspect-square h-full w-full object-cover"
        />
      ) : (
        <span>{fallback.slice(0, 2).toUpperCase()}</span>
      )}
    </div>
  );
}
