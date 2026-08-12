import React from 'react';
import { Search, Sun, Moon } from 'lucide-react';
import { ApiUser } from '../../../lib/api';

interface AppSidebarHeaderProps {
  user: ApiUser;
  darkMode: boolean;
  onToggleDarkMode: () => void;
  onNavigate: (path: string) => void;
}

export const AppSidebarHeader: React.FC<AppSidebarHeaderProps> = ({
  user,
  darkMode,
  onToggleDarkMode,
  onNavigate,
}) => {
  return (
    <div className="space-y-3 px-4 pt-4 pb-2">
      {/* Brand & User Title */}
      <div className="flex items-center justify-between px-1 pt-1 pb-1">
        <div
          className="flex items-center gap-2.5 cursor-pointer min-w-0"
          onClick={() => onNavigate('/admin')}
        >
          <div className="size-8 rounded-md bg-muted border border-border flex items-center justify-center text-xs font-bold text-foreground shrink-0 overflow-hidden shadow-xs">
            {user.name.charAt(0).toUpperCase()}
          </div>
          <span className="font-semibold text-base tracking-tight text-foreground truncate">
            {user.name}
          </span>
        </div>

        <button
          onClick={onToggleDarkMode}
          className="text-muted-foreground hover:text-foreground p-1 rounded-md transition-colors shrink-0 cursor-pointer"
          title="Toggle theme"
          aria-label="Toggle theme"
        >
          {darkMode ? <Sun className="h-4 w-4 text-amber-400" /> : <Moon className="h-4 w-4 text-slate-700" />}
        </button>
      </div>

      {/* Search Button (Vibress Search site ⌘K) */}
      <button
        onClick={() => onNavigate('/admin/posts')}
        className="w-full flex h-9 items-center justify-between rounded-full border border-border/60 bg-muted/40 hover:bg-muted text-xs text-muted-foreground hover:text-foreground px-3.5 shadow-xs transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-2">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <span>Search site</span>
        </div>
        <kbd className="bg-card text-muted-foreground text-[10px] font-mono px-1.5 py-0.5 rounded border border-border shadow-2xs">
          ⌘K
        </kbd>
      </button>
    </div>
  );
};
