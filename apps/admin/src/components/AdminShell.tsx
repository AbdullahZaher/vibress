import React, { useState, useEffect } from "react";
import { type ApiUser, type AdminExtensionViewLink, listExtensionAdminViewsApi } from "../lib/api";
import { AppSidebar } from "./layout/sidebar/AppSidebar";
import { MobileHeader } from "./layout/MobileHeader";
import { CommandPalette } from "./layout/CommandPalette";
import { renderAdminRoute } from "../lib/router";
import { useAdminLocale } from "../lib/admin-locale";

interface AdminShellProps {
  user: ApiUser;
  currentPath: string;
  onNavigate: (path: string) => void;
  onLogout: () => void;
  can: (permissionKey: string) => boolean;
}

export const AdminShell: React.FC<AdminShellProps> = ({
  user,
  currentPath,
  onNavigate,
  onLogout,
  can,
}) => {
  const [darkMode, setDarkMode] = useState(() => {
    try {
      return window.localStorage.getItem("vibress-admin-theme") !== "light";
    } catch {
      return true;
    }
  });
  const { locale, setUiLocale, tr } = useAdminLocale();
  const onToggleLocale = () => setUiLocale(locale === "ar" ? "en" : "ar");
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [extensionViews, setExtensionViews] = useState<AdminExtensionViewLink[]>([]);
  const [extensionViewsLoading, setExtensionViewsLoading] = useState(true);

  // Invalidate asynchronous navigation data on every Host publication change.
  useEffect(() => {
    let disposed = false;
    let generation = 0;
    const refresh = () => {
      const request = ++generation;
      setExtensionViews([]);
      setExtensionViewsLoading(true);
      void listExtensionAdminViewsApi().then(({ items }) => {
        if (!disposed && request === generation) setExtensionViews(items);
      }).catch(() => {
        if (!disposed && request === generation) setExtensionViews([]);
      }).finally(() => {
        if (!disposed && request === generation) setExtensionViewsLoading(false);
      });
    };
    refresh();
    window.addEventListener("vibress:publication-changed", refresh);
    return () => {
      disposed = true;
      generation += 1;
      window.removeEventListener("vibress:publication-changed", refresh);
    };
  }, [user.id]);

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
    try {
      window.localStorage.setItem("vibress-admin-theme", darkMode ? "dark" : "light");
    } catch {
      // Private browsing may disable storage; retain this session's preference.
    }
  }, [darkMode]);

  // Global ⌘K / Ctrl+K keyboard shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setIsCommandPaletteOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const canCreatePosts = can("posts.create");
  const canReadPosts = can("posts.read");
  const canReadPages = can("pages.read");
  const canReadTags = can("tags.read");
  const canReadMedia = can("media.read");
  const canReadMembers = can("members.read");
  const canReadComments = can("comments.read");
  const canCreatePages = can("pages.create");
  const canReadAnalytics = can("analytics.read");
  const isEditorRoute = /^\/admin\/(posts|pages)\/(new|[^/]+)\/?$/.test(currentPath) && !/^\/admin\/posts\/(drafts|review|scheduled|published)\/?$/.test(currentPath);


  return (
    <div className="vibress-admin-workspace flex h-dvh max-h-dvh w-full flex-col overflow-hidden bg-background font-sans text-foreground md:flex-row">
      <a href="#admin-main" className="sr-only fixed start-3 top-3 z-[100] rounded-lg bg-card px-4 py-3 text-sm font-semibold text-foreground shadow-lg focus:not-sr-only focus-visible:outline-2 focus-visible:outline-ring">
        {tr("Skip to main content")}
      </a>
      {/* Mobile Top Header */}
      <MobileHeader
        currentPath={currentPath}
        onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
        onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
        darkMode={darkMode}
        onToggleDarkMode={() => setDarkMode(!darkMode)}
        onNavigate={onNavigate}
        canCreatePosts={canCreatePosts}
        locale={locale}
        onToggleLocale={onToggleLocale}
      />

      {/* Vibress Modular Sidebar */}
      <AppSidebar
        user={user}
        currentPath={currentPath}
        darkMode={darkMode}
        onToggleDarkMode={() => setDarkMode(!darkMode)}
        onNavigate={onNavigate}
        onLogout={onLogout}
        canCreatePosts={canCreatePosts}
        canReadPosts={canReadPosts}
        canReadPages={canReadPages}
        canReadTags={canReadTags}
        canReadMedia={canReadMedia}
        canReadMembers={canReadMembers}
        canReadComments={canReadComments}
        canReadTranslations={can("translations.read")}
        canReadPlugins={can("plugins.read")}
        extensionViews={extensionViews.filter((view) => can(view.permission))}
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
        locale={locale}
        onToggleLocale={onToggleLocale}
      />

      {/* Main Content Area — Delegated to declarative Admin Router with Error Boundaries */}
      <main id="admin-main" tabIndex={-1} className={`min-h-0 min-w-0 flex-1 overflow-y-auto ${isEditorRoute ? "p-0" : "vibress-admin-content px-4 pb-10 pt-6 sm:px-6 sm:pt-8 lg:px-8 lg:pt-10"}`}>
        {renderAdminRoute({
          pathname: currentPath,
          user,
          onNavigate,
          can,
          extensionViews,
          extensionViewsLoading,
        })}
      </main>

      {/* Global Interactive Command Palette (⌘K) */}
      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        onNavigate={onNavigate}
        onToggleDarkMode={() => setDarkMode(!darkMode)}
        darkMode={darkMode}
        onLogout={onLogout}
        canCreatePosts={canCreatePosts}
        canCreatePages={canCreatePages}
        canReadAnalytics={canReadAnalytics}
        canReadPosts={canReadPosts}
        canReadPages={canReadPages}
        canReadTags={canReadTags}
        canReadMedia={canReadMedia}
        canReadMembers={canReadMembers}
        canReadComments={canReadComments}
      />
    </div>
  );
};
