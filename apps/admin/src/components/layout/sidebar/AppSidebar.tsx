import React, { useEffect } from 'react';
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
  isOpen?: boolean | undefined;
  onClose?: (() => void) | undefined;
  onOpenCommandPalette?: (() => void) | undefined;
}

export const AppSidebar: React.FC<AppSidebarProps> = ({
  user,
  currentPath,
  darkMode,
  onToggleDarkMode,
  onNavigate,
  onLogout,
  canPublishPosts,
  isOpen = false,
  onClose,
  onOpenCommandPalette,
}) => {
  // Navigation wrapper that auto-closes mobile sidebar
  const handleNavigate = (path: string) => {
    onNavigate(path);
    onClose?.();
  };

  // Close mobile sidebar on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose?.();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Lock background body scroll on mobile when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  const sidebarContent = (
    <aside className="w-64 h-full max-h-screen bg-sidebar border-r border-sidebar-border flex flex-col shrink-0 select-none overflow-hidden shadow-2xl md:shadow-none">
      {/* Top Header */}
      <div className="shrink-0">
        <AppSidebarHeader
          darkMode={darkMode}
          onToggleDarkMode={onToggleDarkMode}
          onNavigate={handleNavigate}
          onOpenCommandPalette={onOpenCommandPalette}
          onCloseSidebar={onClose}
        />
      </div>

      {/* Middle Navigation Stream (Main & Content) */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-7">
        <NavMain currentPath={currentPath} onNavigate={handleNavigate} />
        <NavContent
          currentPath={currentPath}
          onNavigate={handleNavigate}
          canPublishPosts={canPublishPosts}
        />
      </div>

      {/* Fixed Bottom Section (Settings + Help above What's New & UserNav) */}
      <div className="shrink-0 px-4 py-3 space-y-3 bg-sidebar z-20 border-t border-sidebar-border/30">
        <NavSettings currentPath={currentPath} onNavigate={handleNavigate} />
        <AppSidebarBanner />
        <UserMenu user={user} onLogout={onLogout} onNavigate={handleNavigate} />
      </div>
    </aside>
  );

  return (
    <>
      {/* 1. Desktop Static Sidebar */}
      <div className="hidden md:flex h-full shrink-0 z-30">
        {sidebarContent}
      </div>

      {/* 2. Mobile Slide-Over Drawer with Backdrop */}
      {isOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          {/* Backdrop overlay */}
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-xs transition-opacity animate-in fade-in duration-200"
            onClick={onClose}
            aria-hidden="true"
          />

          {/* Slide-in Sidebar Panel */}
          <div className="relative z-50 flex h-full max-w-[80vw] animate-in slide-in-from-left duration-250 ease-out">
            {sidebarContent}
          </div>
        </div>
      )}
    </>
  );
};
