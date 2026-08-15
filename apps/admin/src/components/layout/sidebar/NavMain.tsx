import React from "react";
import { TrendingUp, Share2, AppWindow, ExternalLink } from "lucide-react";

interface NavMainProps {
  currentPath: string;
  onNavigate: (path: string) => void;
}

export const NavMain: React.FC<NavMainProps> = ({
  currentPath,
  onNavigate,
}) => {
  const isAnalyticsActive =
    currentPath === "/admin" ||
    currentPath === "/admin/" ||
    currentPath.startsWith("/admin/analytics");

  return (
    <div className="space-y-0.5 text-[13px]">
      {/* Analytics */}
      <button
        onClick={() => onNavigate("/admin")}
        className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg font-medium transition-colors cursor-pointer ${
          isAnalyticsActive
            ? "bg-sidebar-accent text-foreground font-semibold border border-sidebar-border/60 shadow-xs"
            : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-foreground"
        }`}
      >
        <TrendingUp className="h-4 w-4 shrink-0" />
        <span>Analytics</span>
      </button>

      {/* Network */}
      <button
        onClick={() => onNavigate("/admin/community")}
        className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg font-medium text-sidebar-foreground hover:bg-sidebar-accent hover:text-foreground transition-colors cursor-pointer"
      >
        <Share2 className="h-4 w-4 shrink-0" />
        <span>Network</span>
      </button>

      {/* View Site */}
      <div className="group/viewsite relative flex items-center">
        <button
          onClick={() => window.open("/", "_blank")}
          className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg font-medium text-sidebar-foreground hover:bg-sidebar-accent hover:text-foreground transition-colors cursor-pointer"
        >
          <AppWindow className="h-4 w-4 shrink-0" />
          <span>View site</span>
        </button>
        <a
          href="/"
          target="_blank"
          rel="noreferrer"
          className="absolute right-2 flex size-6 items-center justify-center rounded-full text-muted-foreground opacity-0 group-hover/viewsite:opacity-100 hover:bg-sidebar-accent hover:text-foreground transition-all"
          title="Open site in new tab"
        >
          <ExternalLink size={13} />
        </a>
      </div>
    </div>
  );
};
