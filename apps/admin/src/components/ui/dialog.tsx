import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";

export function Dialog({
  isOpen,
  onClose,
  title,
  description,
  children,
  className,
}: {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  React.useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = originalOverflow;
    };
  }, [isOpen, onClose]);

  if (!isOpen || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in-0 duration-150"
      role="dialog"
      aria-modal="true"
    >
      <div
        className={cn(
          "relative w-full max-w-lg rounded-xl border border-border/80 bg-card p-6 text-card-foreground shadow-2xl animate-in zoom-in-95 duration-150",
          className,
        )}
      >
        <button
          onClick={onClose}
          className="absolute top-4 end-4 rounded-md p-1 opacity-70 transition-opacity hover:opacity-100 hover:bg-muted text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer"
          aria-label="Close dialog"
        >
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </button>

        {(title || description) && (
          <div className="flex flex-col space-y-1.5 text-start mb-4 pe-6">
            {title && (
              <h2 className="text-base sm:text-lg font-semibold leading-tight tracking-tight text-foreground">
                {title}
              </h2>
            )}
            {description && (
              <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">{description}</p>
            )}
          </div>
        )}

        <div>{children}</div>
      </div>
    </div>,
    document.body,
  );
}
