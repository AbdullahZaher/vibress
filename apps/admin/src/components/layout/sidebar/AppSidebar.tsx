import React, { useEffect, useRef } from "react";
import { ApiUser } from "../../../lib/api";
import { AppSidebarHeader } from "./AppSidebarHeader";
import { NavMain } from "./NavMain";
import { NavContent } from "./NavContent";
import { NavSettings } from "./NavSettings";
import { AppSidebarBanner } from "./AppSidebarBanner";
import { UserMenu } from "./UserMenu";
import { NavExtensionViews } from "./NavExtensionViews";
import type { AdminExtensionViewLink } from "../../../lib/api";
import { useAdminLocale } from "../../../lib/admin-locale";

interface AppSidebarProps {
  user: ApiUser;
  currentPath: string;
  darkMode: boolean;
  onToggleDarkMode: () => void;
  onNavigate: (path: string) => void;
  onLogout: () => void;
  canCreatePosts: boolean;
  canReadTranslations: boolean;
  canReadPlugins: boolean;
  extensionViews: readonly AdminExtensionViewLink[];
  isOpen?: boolean | undefined;
  onClose?: (() => void) | undefined;
  onOpenCommandPalette?: (() => void) | undefined;
  locale?: 'en' | 'ar';
  onToggleLocale?: () => void;
}

export const AppSidebar: React.FC<AppSidebarProps> = ({
  user,
  currentPath,
  darkMode,
  onToggleDarkMode,
  onNavigate,
  onLogout,
  canCreatePosts,
  canReadTranslations,
  canReadPlugins,
  extensionViews,
  isOpen = false,
  onClose,
  onOpenCommandPalette,
  locale = 'en',
  onToggleLocale,
}) => {
  const { tr } = useAdminLocale();
  const mobileDialogRef = useRef<HTMLDivElement>(null);

  // Navigation wrapper that auto-closes mobile sidebar
  const handleNavigate = (path: string) => {
    onNavigate(path);
    onClose?.();
  };

  // Close mobile sidebar on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose?.();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  // Lock background body scroll on mobile when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = mobileDialogRef.current;
    dialog?.querySelector<HTMLButtonElement>("[data-sidebar-close]")?.focus();
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || !dialog) return;
      const options = Array.from(dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )).filter((node) => node.getClientRects().length > 0);
      if (!options.length) return;
      const first = options[0]!;
      const last = options[options.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    dialog?.addEventListener("keydown", trapFocus);
    return () => {
      dialog?.removeEventListener("keydown", trapFocus);
      previousFocus?.focus();
    };
  }, [isOpen]);

  const sidebarContent = (
    <aside className="w-[min(18rem,85vw)] h-full max-h-screen bg-sidebar border-e border-sidebar-border flex flex-col shrink-0 select-none overflow-hidden shadow-2xl md:shadow-none">
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
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-5">
        <NavMain currentPath={currentPath} onNavigate={handleNavigate} />
        <NavContent
          currentPath={currentPath}
          onNavigate={handleNavigate}
          canCreatePosts={canCreatePosts}
          canReadTranslations={canReadTranslations}
        />
        <NavExtensionViews
          items={extensionViews}
          currentPath={currentPath}
          onNavigate={handleNavigate}
        />
      </div>

      {/* Fixed Bottom Section (Settings + Help above What's New & UserNav) */}
      <div className="shrink-0 px-4 py-3 space-y-3 bg-sidebar z-20">
        <NavSettings currentPath={currentPath} onNavigate={handleNavigate} canReadPlugins={canReadPlugins} />
        <AppSidebarBanner onNavigate={handleNavigate} />
        <UserMenu user={user} onLogout={onLogout} onNavigate={handleNavigate} locale={locale} onToggleLocale={onToggleLocale} />
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
        <div ref={mobileDialogRef} role="dialog" aria-modal="true" aria-label={tr("Navigation menu")} className="md:hidden fixed inset-0 z-50 flex">
          {/* Backdrop overlay */}
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-xs transition-opacity animate-in fade-in duration-200"
            onClick={onClose}
            aria-hidden="true"
          />

          {/* Slide-in Sidebar Panel */}
          <div className="relative z-50 flex h-full w-[min(18rem,85vw)] animate-in ltr:slide-in-from-left rtl:slide-in-from-right duration-200 ease-out">
            {sidebarContent}
          </div>
        </div>
      )}
    </>
  );
};
