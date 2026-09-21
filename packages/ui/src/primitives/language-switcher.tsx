import * as React from "react";
import { Globe, ChevronDown, Check } from "lucide-react";
import { cn } from "../utils";

export interface LanguageSwitcherProps {
  locale: string;
  onSelectLocale: (locale: "en" | "ar") => void;
  className?: string;
  enLabel?: string;
  arLabel?: string;
}

export function LanguageSwitcher({
  locale,
  onSelectLocale,
  className,
  enLabel = "English",
  arLabel = "العربية",
}: LanguageSwitcherProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  const isEn = locale.startsWith("en");
  const isAr = locale.startsWith("ar");

  const currentLabel = isAr ? arLabel : enLabel;

  // Handle outside click & escape key
  React.useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const handleSelect = (lang: "en" | "ar") => {
    onSelectLocale(lang);
    setIsOpen(false);
  };

  return (
    <div
      ref={containerRef}
      className={cn("relative inline-block text-start", className)}
    >
      {/* Modern Select Trigger */}
      <button
        type="button"
        id="portal-language-selector"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label="Select language"
        className={cn(
          "inline-flex h-9 sm:h-10 items-center gap-2 rounded-xl border border-border bg-card/90 px-3 py-1.5 text-xs sm:text-sm font-semibold text-foreground shadow-2xs backdrop-blur-xs transition-all hover:bg-muted/70 hover:border-border/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer select-none",
          isOpen && "ring-2 ring-ring/30 border-primary/50 bg-muted/60",
        )}
      >
        <Globe className="size-4 shrink-0 text-muted-foreground" />
        <span className="leading-none">{currentLabel}</span>
        <ChevronDown
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform duration-200",
            isOpen && "rotate-180",
          )}
        />
      </button>

      {/* Floating Select Menu Panel */}
      {isOpen && (
        <div
          role="listbox"
          aria-label="Languages"
          className="absolute end-0 top-full mt-1.5 z-50 min-w-[150px] w-full sm:w-auto rounded-xl border border-border bg-popover/95 backdrop-blur-md p-1.5 shadow-lg animate-in fade-in-0 zoom-in-95 duration-150 focus:outline-none"
        >
          <button
            type="button"
            id="portal-lang-en"
            role="option"
            aria-selected={isEn}
            onClick={() => handleSelect("en")}
            className={cn(
              "flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-xs sm:text-sm transition-colors cursor-pointer select-none text-start",
              isEn
                ? "bg-primary/10 text-primary font-bold"
                : "text-foreground hover:bg-muted/80 font-medium",
            )}
          >
            <span>{enLabel}</span>
            {isEn && <Check className="size-4 text-primary shrink-0" />}
          </button>

          <button
            type="button"
            id="portal-lang-ar"
            role="option"
            aria-selected={isAr}
            onClick={() => handleSelect("ar")}
            className={cn(
              "flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-xs sm:text-sm transition-colors cursor-pointer select-none text-start mt-1",
              isAr
                ? "bg-primary/10 text-primary font-bold"
                : "text-foreground hover:bg-muted/80 font-medium",
            )}
          >
            <span>{arLabel}</span>
            {isAr && <Check className="size-4 text-primary shrink-0" />}
          </button>
        </div>
      )}
    </div>
  );
}
