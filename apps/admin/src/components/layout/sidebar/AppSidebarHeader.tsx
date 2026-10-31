import React from "react";
import { Search, Sun, Moon, X } from "lucide-react";
import vibressLogo from "../../../assets/images/vibress-logo.png";
import { useAdminLocale } from "../../../lib/admin-locale";

interface AppSidebarHeaderProps {
  darkMode: boolean;
  onToggleDarkMode: () => void;
  onNavigate: (path: string) => void;
  onOpenCommandPalette?: (() => void) | undefined;
  onCloseSidebar?: (() => void) | undefined;
}

export const AppSidebarHeader: React.FC<AppSidebarHeaderProps> = ({
  darkMode,
  onToggleDarkMode,
  onNavigate,
  onOpenCommandPalette,
  onCloseSidebar,
}) => {
  const { tr } = useAdminLocale();
  return (
    <div className="space-y-3 px-4 pt-4 pb-2">
      {/* Brand Logo + Wordmark + Actions */}
      <div className="flex items-center justify-between px-1 pt-1 pb-1">
        <button
          type="button"
          aria-label={tr("Dashboard")}
          className="flex min-h-11 items-center gap-2 cursor-pointer min-w-0 rounded-lg focus-visible:outline-2 focus-visible:outline-ring"
          onClick={() => {
            onNavigate("/admin");
            onCloseSidebar?.();
          }}
          title="Vibress Admin"
        >
          <img src={vibressLogo} alt="" className="h-6 w-auto object-contain" />
          <span className="font-bold text-lg tracking-tight text-foreground truncate">
            Vibress
          </span>
        </button>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onToggleDarkMode}
            className="text-muted-foreground hover:text-foreground size-9 flex items-center justify-center rounded-md hover:bg-sidebar-accent transition-colors shrink-0 cursor-pointer"
            title="Toggle theme"
            aria-label="Toggle theme"
          >
            {darkMode ? (
              <Sun className="h-4 w-4 text-amber-400" />
            ) : (
              <Moon className="h-4 w-4 text-slate-700" />
            )}
          </button>

          {/* Close button visible only on mobile drawer */}
          {onCloseSidebar && (
            <button
              type="button"
              data-sidebar-close
              onClick={onCloseSidebar}
              className="md:hidden text-muted-foreground hover:text-foreground size-9 flex items-center justify-center rounded-md hover:bg-sidebar-accent transition-colors shrink-0 cursor-pointer"
              title="Close menu"
              aria-label="Close menu"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Search Button (Vibress Search site ⌘K) */}
      <button
        type="button"
        onClick={() => {
          if (onOpenCommandPalette) {
            onOpenCommandPalette();
          } else {
            onNavigate("/admin/posts");
          }
          onCloseSidebar?.();
        }}
        className="w-full flex min-h-11 items-center justify-between rounded-xl border border-sidebar-border bg-muted/30 hover:bg-sidebar-accent text-sm text-muted-foreground hover:text-foreground px-3.5 transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-ring"
      >
        <div className="flex items-center gap-2">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <span>{tr("Search & commands")}</span>
        </div>
        <kbd className="bg-card text-muted-foreground text-[10px] font-mono px-1.5 py-0.5 rounded border border-border shadow-2xs">
          ⌘ / Ctrl K
        </kbd>
      </button>
    </div>
  );
};
