import React from "react";
import { useAdminLocale } from "../../../lib/admin-locale";
import { TrendingUp, AppWindow } from "lucide-react";

interface NavMainProps {
  currentPath: string;
  onNavigate: (path: string) => void;
}

export const NavMain: React.FC<NavMainProps> = ({
  currentPath,
  onNavigate,
}) => {
  const { tr } = useAdminLocale();
  const isAnalyticsActive =
    currentPath === "/admin" ||
    currentPath === "/admin/" ||
    currentPath.startsWith("/admin/analytics");

  return (
    <div className="space-y-0.5 text-sm">
      {/* Analytics */}
      <button
        type="button"
        aria-current={isAnalyticsActive ? "page" : undefined}
        onClick={() => onNavigate("/admin")}
        className={`w-full flex min-h-11 items-center gap-2.5 px-2.5 py-2.5 rounded-lg font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring cursor-pointer ${
          isAnalyticsActive
            ? "bg-sidebar-accent text-foreground font-semibold border-s-2 border-primary"
            : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-foreground"
        }`}
      >
        <TrendingUp className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span>{tr("Analytics")}</span>
      </button>


      {/* View Site */}
      <div className="relative flex items-center">
        <a
          href="/"
          target="_blank"
          rel="noopener noreferrer"
          className="w-full flex min-h-11 items-center gap-2.5 px-2.5 py-2.5 rounded-lg font-medium text-sidebar-foreground hover:bg-sidebar-accent hover:text-foreground transition-colors focus-visible:outline-2 focus-visible:outline-ring"
        >
          <AppWindow className="h-4 w-4 shrink-0" />
          <span>{tr("View site")}</span>
        </a>
      </div>
    </div>
  );
};
