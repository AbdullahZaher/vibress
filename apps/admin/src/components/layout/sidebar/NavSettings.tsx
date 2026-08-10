import React, { useState } from 'react';
import { Settings, ChevronDown, HelpCircle } from 'lucide-react';

interface NavSettingsProps {
  onNavigate: (path: string) => void;
}

export const NavSettings: React.FC<NavSettingsProps> = ({ onNavigate }) => {
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <div className="space-y-0.5 text-[13px]">
      {/* Settings Trigger */}
      <button
        onClick={() => setSettingsOpen(!settingsOpen)}
        className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg font-medium text-sidebar-foreground hover:bg-sidebar-accent hover:text-foreground transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-2.5">
          <Settings className="h-4 w-4 shrink-0" />
          <span>Settings</span>
        </div>
        <ChevronDown
          className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${
            settingsOpen ? 'rotate-180' : ''
          }`}
        />
      </button>

      {/* Expanded Settings Menu */}
      {settingsOpen && (
        <div className="pl-9 space-y-0.5 text-[12px]">
          <button onClick={() => onNavigate('/admin/settings/themes')} className="block w-full text-left py-1 text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
            Themes
          </button>
          <button onClick={() => onNavigate('/admin/settings/billing')} className="block w-full text-left py-1 text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
            Billing
          </button>
          <button onClick={() => onNavigate('/admin/newsletters')} className="block w-full text-left py-1 text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
            Newsletters
          </button>
          <button onClick={() => onNavigate('/admin/settings/storage')} className="block w-full text-left py-1 text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
            Storage
          </button>
          <button onClick={() => onNavigate('/admin/settings/platform')} className="block w-full text-left py-1 text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
            Platform
          </button>
          <button onClick={() => onNavigate('/admin/settings/operations')} className="block w-full text-left py-1 text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
            Operations
          </button>
        </div>
      )}

      {/* Help */}
      <button
        onClick={() => alert('Vibress Administration Help')}
        className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg font-medium text-sidebar-foreground hover:bg-sidebar-accent hover:text-foreground transition-colors cursor-pointer"
      >
        <HelpCircle className="h-4 w-4 shrink-0" />
        <span>Help</span>
      </button>
    </div>
  );
};
