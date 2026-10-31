import React from "react";
import { useAdminLocale } from "../../../lib/admin-locale";
import { Settings, HelpCircle, Puzzle } from "lucide-react";

interface NavSettingsProps {
  currentPath: string;
  onNavigate: (path: string) => void;
  canReadPlugins: boolean;
}

export const NavSettings: React.FC<NavSettingsProps> = ({
  currentPath,
  onNavigate,
  canReadPlugins,
}) => {
  const { tr } = useAdminLocale();
  const isPluginsActive =
    currentPath === "/admin/plugins" || currentPath === "/admin/plugins/";
  const isSettingsActive =
    currentPath === "/admin/settings" ||
    currentPath.startsWith("/admin/settings/") ||
    currentPath.startsWith("/admin/models") ||
    currentPath.startsWith("/admin/newsletters");

  return (
    <div className="space-y-0.5 text-sm">
      {/* First-class Plugins management, immediately above Settings. */}
      {canReadPlugins && (
        <button
          type="button"
          onClick={() => onNavigate("/admin/plugins")}
          aria-current={isPluginsActive ? "page" : undefined}
          className={`w-full flex min-h-11 items-center gap-2.5 px-2.5 py-2.5 rounded-lg font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring cursor-pointer ${
            isPluginsActive
              ? "bg-sidebar-accent text-foreground font-semibold border-s-2 border-primary"
              : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-foreground"
          }`}
        >
          <Puzzle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{tr("Plugins")}</span>
        </button>
      )}

      {/* Settings Navigation Item */}
      <button
        type="button"
        onClick={() => onNavigate("/admin/settings")}
        aria-current={isSettingsActive ? "page" : undefined}
        className={`w-full flex min-h-11 items-center gap-2.5 px-2.5 py-2.5 rounded-lg font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring cursor-pointer ${
          isSettingsActive
            ? "bg-sidebar-accent text-foreground font-semibold border-s-2 border-primary"
            : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-foreground"
        }`}
      >
        <Settings className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span>{tr("Settings")}</span>
      </button>

      {/* Help */}
      <a
        href="https://vibress.com/docs"
        target="_blank"
        rel="noopener noreferrer"
        className="w-full flex min-h-11 items-center gap-2.5 px-2.5 py-2.5 rounded-lg font-medium text-sidebar-foreground hover:bg-sidebar-accent hover:text-foreground transition-colors focus-visible:outline-2 focus-visible:outline-ring"
      >
        <HelpCircle className="h-4 w-4 shrink-0" />
        <span>{tr("Help")}</span>
      </a>
    </div>
  );
};
