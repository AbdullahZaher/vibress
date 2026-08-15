import React, { useState, useEffect } from "react";
import { ApiUser } from "../lib/api";
import { PostsList } from "./PostsList";
import { PostEditor } from "./PostEditor";
import { PagesList } from "./PagesList";
import { PageEditor } from "./PageEditor";
import { TagsManager } from "./TagsManager";
import { MediaLibrary } from "./MediaLibrary";
import { MembersList } from "./MembersList";
import { SettingsHub } from "./settings/SettingsHub";

import { AppSidebar } from "./layout/sidebar/AppSidebar";
import { AnalyticsDashboard } from "./layout/AnalyticsDashboard";
import { MobileHeader } from "./layout/MobileHeader";
import { CommandPalette } from "./layout/CommandPalette";

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
  const [darkMode, setDarkMode] = useState(true);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
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

  const canPublishPosts = can("posts.publish");
  const canPublishPages = can("pages.publish");

  // Route Views Renderer
  const renderContent = () => {
    // 1. Posts & Editor Routes
    if (currentPath === "/admin/posts" || currentPath === "/admin/posts/") {
      return <PostsList onNavigate={onNavigate} canPublish={canPublishPosts} />;
    }
    if (currentPath === "/admin/posts/drafts") {
      return (
        <PostsList
          onNavigate={onNavigate}
          canPublish={canPublishPosts}
          filterStatus="draft"
        />
      );
    }
    if (currentPath === "/admin/posts/scheduled") {
      return (
        <PostsList
          onNavigate={onNavigate}
          canPublish={canPublishPosts}
          filterStatus="scheduled"
        />
      );
    }
    if (currentPath === "/admin/posts/published") {
      return (
        <PostsList
          onNavigate={onNavigate}
          canPublish={canPublishPosts}
          filterStatus="published"
        />
      );
    }
    if (currentPath === "/admin/posts/new") {
      return (
        <PostEditor
          currentUserId={user.id}
          canPublish={canPublishPosts}
          onNavigate={onNavigate}
        />
      );
    }
    if (currentPath.startsWith("/admin/posts/")) {
      const postId = currentPath.split("/admin/posts/")[1];
      return (
        <PostEditor
          postId={postId}
          currentUserId={user.id}
          canPublish={canPublishPosts}
          onNavigate={onNavigate}
        />
      );
    }

    // 2. Pages Routes
    if (currentPath === "/admin/pages" || currentPath === "/admin/pages/") {
      return <PagesList onNavigate={onNavigate} canPublish={canPublishPages} />;
    }
    if (currentPath === "/admin/pages/new") {
      return (
        <PageEditor
          currentUserId={user.id}
          canPublish={canPublishPages}
          onNavigate={onNavigate}
        />
      );
    }
    if (currentPath.startsWith("/admin/pages/")) {
      const pageId = currentPath.split("/admin/pages/")[1];
      return (
        <PageEditor
          pageId={pageId}
          currentUserId={user.id}
          canPublish={canPublishPages}
          onNavigate={onNavigate}
        />
      );
    }

    // 3. Taxonomy & Content Assets
    if (currentPath === "/admin/tags" || currentPath === "/admin/tags/") {
      return <TagsManager />;
    }
    if (
      currentPath === "/admin/media" ||
      currentPath === "/admin/media/" ||
      currentPath.startsWith("/admin/media/")
    ) {
      return <MediaLibrary />;
    }
    if (
      currentPath === "/admin/members" ||
      currentPath === "/admin/members/" ||
      currentPath.startsWith("/admin/members")
    ) {
      return <MembersList />;
    }

    // 4. Unified Settings Hub Routes (All 5 Pillars + Legacy Route Aliases)
    if (
      currentPath === "/admin/settings" ||
      currentPath === "/admin/settings/" ||
      currentPath.startsWith("/admin/settings/general")
    ) {
      return <SettingsHub initialSection="general" can={can} />;
    }

    if (
      currentPath.startsWith("/admin/settings/site") ||
      currentPath.startsWith("/admin/settings/themes") ||
      currentPath.startsWith("/admin/settings/storage")
    ) {
      return <SettingsHub initialSection="site" can={can} />;
    }

    if (
      currentPath.startsWith("/admin/settings/membership") ||
      currentPath.startsWith("/admin/settings/billing") ||
      currentPath.startsWith("/admin/subscriptions")
    ) {
      return <SettingsHub initialSection="membership" can={can} />;
    }

    if (
      currentPath.startsWith("/admin/settings/growth") ||
      currentPath.startsWith("/admin/newsletters") ||
      currentPath.startsWith("/admin/analytics") ||
      currentPath.startsWith("/admin/community")
    ) {
      return <SettingsHub initialSection="growth" can={can} />;
    }

    if (
      currentPath.startsWith("/admin/settings/advanced") ||
      currentPath.startsWith("/admin/settings/platform") ||
      currentPath.startsWith("/admin/settings/operations")
    ) {
      return <SettingsHub initialSection="advanced" can={can} />;
    }

    // Default Fallback View: Analytics Dashboard
    return <AnalyticsDashboard user={user} />;
  };

  return (
    <div className="h-screen max-h-screen w-screen bg-background text-foreground flex flex-col md:flex-row overflow-hidden font-sans">
      {/* Mobile Top Header */}
      <MobileHeader
        currentPath={currentPath}
        onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
        onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
        darkMode={darkMode}
        onToggleDarkMode={() => setDarkMode(!darkMode)}
        onNavigate={onNavigate}
        canPublishPosts={canPublishPosts}
      />

      {/* Vibress Modular Sidebar */}
      <AppSidebar
        user={user}
        currentPath={currentPath}
        darkMode={darkMode}
        onToggleDarkMode={() => setDarkMode(!darkMode)}
        onNavigate={onNavigate}
        onLogout={onLogout}
        canPublishPosts={canPublishPosts}
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
      />

      {/* Main Content Area */}
      <main className="flex-1 h-full max-h-[calc(100vh-3.5rem)] md:max-h-screen overflow-y-auto p-4 sm:p-6 md:p-8">
        {renderContent()}
      </main>

      {/* Global Interactive Command Palette (⌘K) */}
      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        onNavigate={onNavigate}
        onToggleDarkMode={() => setDarkMode(!darkMode)}
        darkMode={darkMode}
        onLogout={onLogout}
        canPublishPosts={canPublishPosts}
      />
    </div>
  );
};
