import * as React from "react";
import { cn } from "../utils";

export interface AvatarProps {
  src?: string;
  alt?: string;
  fallback: string;
  className?: string;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
}

export function Avatar({
  src,
  alt,
  fallback,
  className,
  size = "md",
}: AvatarProps) {
  const [hasError, setHasError] = React.useState(false);

  const sizeClasses = {
    xs: "h-6 w-6 text-[10px]",
    sm: "h-7 w-7 text-xs",
    md: "h-9 w-9 text-xs sm:text-sm",
    lg: "h-12 w-12 text-base",
    xl: "h-16 w-16 text-lg",
  };

  const getInitials = (text: string) => {
    if (!text) return "?";
    const cleaned = text.trim();
    if (cleaned.includes("@")) {
      return cleaned.slice(0, 2).toUpperCase();
    }
    const parts = cleaned.split(/\s+/);
    if (parts.length >= 2) {
      return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase();
    }
    return cleaned.slice(0, 2).toUpperCase();
  };

  return (
    <div
      className={cn(
        "relative flex shrink-0 overflow-hidden rounded-full border border-border bg-muted font-bold justify-center items-center text-muted-foreground select-none",
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
        <span>{getInitials(fallback)}</span>
      )}
    </div>
  );
}
