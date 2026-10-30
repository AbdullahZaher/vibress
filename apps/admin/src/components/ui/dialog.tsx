import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";
import { useAdminLocale } from "../../lib/admin-locale";

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
  const { tr } = useAdminLocale();
  const titleId = React.useId();
  const descriptionId = React.useId();
  const contentRef = React.useRef<HTMLDivElement>(null);
  const onCloseRef = React.useRef(onClose);
  onCloseRef.current = onClose;

  React.useEffect(() => {
    if (!isOpen) return;
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const originalOverflow = document.body.style.overflow;

    const getFocusable = () => {
      const content = contentRef.current;
      if (!content) return [];
      return Array.from(content.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )).filter((element) => element.getClientRects().length > 0);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = getFocusable();
      if (focusable.length === 0) {
        event.preventDefault();
        contentRef.current?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === contentRef.current || !contentRef.current?.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !contentRef.current?.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);
    contentRef.current?.focus();

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = originalOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [isOpen]);

  if (!isOpen || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto p-4 bg-black/60 backdrop-blur-xs animate-in fade-in-0 duration-150"
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? titleId : undefined}
      aria-describedby={description ? descriptionId : undefined}
      aria-label={!title ? "Dialog" : undefined}
    >
      <div
        ref={contentRef}
        tabIndex={-1}
        className={cn(
          "relative my-auto w-full max-w-lg rounded-xl border border-border/80 bg-card p-5 sm:p-6 text-card-foreground shadow-2xl outline-none animate-in zoom-in-95 duration-150",
          className,
        )}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 end-4 inline-flex size-10 items-center justify-center rounded-md opacity-70 transition-opacity hover:opacity-100 hover:bg-muted text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring cursor-pointer"
          aria-label={tr("Close dialog")}
        >
          <X className="h-4 w-4" aria-hidden="true" />
          <span className="sr-only">{tr("Close")}</span>
        </button>

        {(title || description) && (
          <div className="flex flex-col space-y-1.5 text-start mb-4 pe-10">
            {title && (
              <h2 id={titleId} className="text-base sm:text-lg font-semibold leading-tight tracking-tight text-foreground">
                {title}
              </h2>
            )}
            {description && (
              <p id={descriptionId} className="text-xs sm:text-sm text-muted-foreground leading-relaxed">{description}</p>
            )}
          </div>
        )}

        <div>{children}</div>
      </div>
    </div>,
    document.body,
  );
}
