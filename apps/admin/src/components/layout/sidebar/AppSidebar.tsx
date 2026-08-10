import React from 'react';
import { ApiUser } from '../../../lib/api';
import { AppSidebarHeader } from './AppSidebarHeader';
import { NavMain } from './NavMain';
import { NavContent } from './NavContent';
import { NavSettings } from './NavSettings';
import { AppSidebarBanner } from './AppSidebarBanner';
import { UserMenu } from './UserMenu';

interface AppSidebarProps {
  user: ApiUser;
  currentPath: string;
  darkMode: boolean;
  onToggleDarkMode: () => void;
  onNavigate: (path: string) => void;
  onLogout: () => void;
  canPublishPosts: boolean;
}

export const AppSidebar: React.FC<AppSidebarProps> = ({
  user,
  currentPath,
  darkMode,
  onToggleDarkMode,
  onNavigate,
  onLogout,
  canPublishPosts,
}) => {
  return (
    <aside className="w-64 h-full max-h-screen bg-sidebar border-r border-sidebar-border flex flex-col shrink-0 z-30 select-none overflow-hidden">
      {/* Top Header */}
      <div className="shrink-0">
        <AppSidebarHeader
          user={user}
          darkMode={darkMode}
          onToggleDarkMode={onToggleDarkMode}
          onNavigate={onNavigate}
        />
      </div>

      {/* Middle Navigation Stream (Main & Content) */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-7">
        <NavMain currentPath={currentPath} onNavigate={onNavigate} />
        <NavContent
          currentPath={currentPath}
          onNavigate={onNavigate}
          canPublishPosts={canPublishPosts}
        />
      </div>

      {/* Fixed Bottom Section (Settings + Help above What's New & UserNav) */}
      <div className="shrink-0 px-4 py-3 space-y-3 bg-sidebar z-20 border-t border-sidebar-border/30">
        <NavSettings onNavigate={onNavigate} />
        <AppSidebarBanner />
        <UserMenu user={user} onLogout={onLogout} />
      </div>
    </aside>
  );
};
