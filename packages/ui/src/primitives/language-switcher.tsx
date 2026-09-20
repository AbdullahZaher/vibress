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
  const isEn = locale.startsWith("en");
  const isAr = locale.startsWith("ar");

  return (
    <div
      className={cn(
        "inline-flex items-center rounded-lg border border-border/80 bg-card p-0.5 shadow-2xs gap-0.5",
        className,
      )}
      role="group"
      aria-label="Language selector"
    >
      <button
        type="button"
        id="portal-lang-en"
        onClick={() => onSelectLocale("en")}
        className={cn(
          "inline-flex h-7 sm:h-8 items-center justify-center rounded-md px-2 text-xs font-medium transition-all cursor-pointer select-none whitespace-nowrap",
          isEn
            ? "bg-primary text-primary-foreground shadow-xs font-semibold"
            : "text-muted-foreground hover:text-foreground hover:bg-muted/40",
        )}
        aria-pressed={isEn}
        aria-label="Switch to English"
      >
        {enLabel}
      </button>
      <button
        type="button"
        id="portal-lang-ar"
        onClick={() => onSelectLocale("ar")}
        className={cn(
          "inline-flex h-7 sm:h-8 items-center justify-center rounded-md px-2 text-xs font-medium transition-all cursor-pointer select-none whitespace-nowrap",
          isAr
            ? "bg-primary text-primary-foreground shadow-xs font-semibold"
            : "text-muted-foreground hover:text-foreground hover:bg-muted/40",
        )}
        aria-pressed={isAr}
        aria-label="التبديل إلى العربية"
      >
        {arLabel}
      </button>
    </div>
  );
}
