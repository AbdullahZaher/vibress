import React, { useState, useEffect } from "react";
import {
  Settings,
  ChevronDown,
  HelpCircle,
  Sliders,
  Layout,
  CreditCard,
  Sparkles,
  Cpu,
} from "lucide-react";

interface NavSettingsProps {
  currentPath: string;
  onNavigate: (path: string) => void;
}

export const NavSettings: React.FC<NavSettingsProps> = ({
  currentPath,
  onNavigate,
}) => {
  const isSettingsActive =
    currentPath.startsWith("/admin/settings") ||
    currentPath.startsWith("/admin/newsletters");

  const [settingsOpen, setSettingsOpen] = useState(isSettingsActive);

  // Auto-expand settings whenever the current path is inside settings
  useEffect(() => {
    if (isSettingsActive) {
      setSettingsOpen(true);
    }
  }, [isSettingsActive]);

  const settingsItems = [
    {
      label: "General settings",
      path: "/admin/settings/general",
      icon: <Sliders className="h-3.5 w-3.5 shrink-0" />,
      active:
        currentPath === "/admin/settings" ||
        currentPath === "/admin/settings/" ||
        currentPath.startsWith("/admin/settings/general"),
    },
    {
      label: "Site",
      path: "/admin/settings/site",
      icon: <Layout className="h-3.5 w-3.5 shrink-0" />,
      active:
        currentPath.startsWith("/admin/settings/site") ||
        currentPath.startsWith("/admin/settings/themes") ||
        currentPath.startsWith("/admin/settings/storage"),
    },
    {
      label: "Membership",
      path: "/admin/settings/membership",
      icon: <CreditCard className="h-3.5 w-3.5 shrink-0" />,
      active:
        currentPath.startsWith("/admin/settings/membership") ||
        currentPath.startsWith("/admin/settings/billing") ||
        currentPath.startsWith("/admin/subscriptions"),
    },
    {
      label: "Growth",
      path: "/admin/settings/growth",
      icon: <Sparkles className="h-3.5 w-3.5 shrink-0" />,
      active:
        currentPath.startsWith("/admin/settings/growth") ||
        currentPath.startsWith("/admin/newsletters"),
    },
    {
      label: "Advanced",
      path: "/admin/settings/advanced",
      icon: <Cpu className="h-3.5 w-3.5 shrink-0" />,
      active:
        currentPath.startsWith("/admin/settings/advanced") ||
        currentPath.startsWith("/admin/settings/platform") ||
        currentPath.startsWith("/admin/settings/operations"),
    },
  ];

  return (
    <div className="space-y-0.5 text-[13px]">
      {/* Settings Trigger */}
      <button
        type="button"
        onClick={() => setSettingsOpen(!settingsOpen)}
        className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg font-medium transition-colors cursor-pointer ${
          isSettingsActive && !settingsOpen
            ? "bg-sidebar-accent text-foreground font-semibold border border-sidebar-border/60"
            : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-foreground"
        }`}
      >
        <div className="flex items-center gap-2.5">
          <Settings className="h-4 w-4 shrink-0" />
          <span>Settings</span>
        </div>
        <ChevronDown
          className={`h-3.5 w-3.5 text-muted-foreground transition-transform duration-200 ${
            settingsOpen ? "rotate-180" : ""
          }`}
        />
      </button>

      {/* Expanded Settings Menu */}
      {settingsOpen && (
        <div className="relative ml-4 pl-3.5 border-l border-sidebar-border/70 space-y-0.5 text-[12px] my-1">
          {settingsItems.map((item) => (
            <button
              key={item.path}
              type="button"
              onClick={() => onNavigate(item.path)}
              className={`w-full flex items-center gap-2.5 text-left py-1.5 px-2 rounded-md transition-colors cursor-pointer font-medium ${
                item.active
                  ? "text-foreground font-semibold bg-sidebar-accent/80 shadow-2xs"
                  : "text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/40"
              }`}
            >
              {item.icon}
              <span className="truncate">{item.label}</span>
            </button>
          ))}
        </div>
      )}

      {/* Help */}
      <button
        type="button"
        onClick={() => window.open("https://vibress.com/docs", "_blank")}
        className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg font-medium text-sidebar-foreground hover:bg-sidebar-accent hover:text-foreground transition-colors cursor-pointer"
      >
        <HelpCircle className="h-4 w-4 shrink-0" />
        <span>Help</span>
      </button>
    </div>
  );
};
