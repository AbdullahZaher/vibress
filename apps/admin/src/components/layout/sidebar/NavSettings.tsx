import React, { useState, useEffect } from 'react';
import { Settings, ChevronDown, HelpCircle, Palette, CreditCard, Mail, HardDrive, Sliders, Activity } from 'lucide-react';

interface NavSettingsProps {
  currentPath: string;
  onNavigate: (path: string) => void;
}

export const NavSettings: React.FC<NavSettingsProps> = ({ currentPath, onNavigate }) => {
  const isSettingsActive =
    currentPath.startsWith('/admin/settings') || currentPath.startsWith('/admin/newsletters');

  const [settingsOpen, setSettingsOpen] = useState(isSettingsActive);

  // Auto-expand settings whenever the current path is inside settings
  useEffect(() => {
    if (isSettingsActive) {
      setSettingsOpen(true);
    }
  }, [isSettingsActive]);

  const settingsItems = [
    {
      label: 'Themes',
      path: '/admin/settings/themes',
      icon: <Palette className="h-3.5 w-3.5 shrink-0" />,
      active: currentPath.startsWith('/admin/settings/themes'),
    },
    {
      label: 'Billing',
      path: '/admin/settings/billing',
      icon: <CreditCard className="h-3.5 w-3.5 shrink-0" />,
      active: currentPath.startsWith('/admin/settings/billing'),
    },
    {
      label: 'Newsletters',
      path: '/admin/newsletters',
      icon: <Mail className="h-3.5 w-3.5 shrink-0" />,
      active: currentPath.startsWith('/admin/newsletters'),
    },
    {
      label: 'Storage',
      path: '/admin/settings/storage',
      icon: <HardDrive className="h-3.5 w-3.5 shrink-0" />,
      active: currentPath.startsWith('/admin/settings/storage'),
    },
    {
      label: 'Platform',
      path: '/admin/settings/platform',
      icon: <Sliders className="h-3.5 w-3.5 shrink-0" />,
      active: currentPath.startsWith('/admin/settings/platform'),
    },
    {
      label: 'Operations',
      path: '/admin/settings/operations',
      icon: <Activity className="h-3.5 w-3.5 shrink-0" />,
      active: currentPath.startsWith('/admin/settings/operations'),
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
            ? 'bg-sidebar-accent text-foreground font-semibold border border-sidebar-border/60'
            : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-foreground'
        }`}
      >
        <div className="flex items-center gap-2.5">
          <Settings className="h-4 w-4 shrink-0" />
          <span>Settings</span>
        </div>
        <ChevronDown
          className={`h-3.5 w-3.5 text-muted-foreground transition-transform duration-200 ${
            settingsOpen ? 'rotate-180' : ''
          }`}
        />
      </button>

      {/* Expanded Settings Menu */}
      {settingsOpen && (
        <div className="relative ml-4 pl-3.5 border-l border-sidebar-border/70 space-y-0 text-[12px] my-0.5">
          {settingsItems.map((item) => (
            <button
              key={item.path}
              type="button"
              onClick={() => onNavigate(item.path)}
              className={`w-full flex items-center gap-2 text-left py-1 px-2 rounded-md transition-colors cursor-pointer font-medium ${
                item.active
                  ? 'text-foreground font-semibold bg-sidebar-accent/70'
                  : 'text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/40'
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
        onClick={() => alert('Vibress Administration Help & Support')}
        className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg font-medium text-sidebar-foreground hover:bg-sidebar-accent hover:text-foreground transition-colors cursor-pointer"
      >
        <HelpCircle className="h-4 w-4 shrink-0" />
        <span>Help</span>
      </button>
    </div>
  );
};
