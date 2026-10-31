import React from "react";
import { useAdminLocale } from "../../lib/admin-locale";
import { Menu, Sun, Moon, Search, Plus } from "lucide-react";
import vibressLogo from "../../assets/images/vibress-logo.png";
import { Button } from "../ui/button";
import { IconButton } from "../ui/icon-button";

interface MobileHeaderProps {
  currentPath: string;
  onToggleSidebar: () => void;
  onOpenCommandPalette: () => void;
  darkMode: boolean;
  onToggleDarkMode: () => void;
  onNavigate: (path: string) => void;
  canCreatePosts: boolean;
  locale?: 'en' | 'ar';
  onToggleLocale?: () => void;
}

export const MobileHeader: React.FC<MobileHeaderProps> = ({
  currentPath,
  onToggleSidebar,
  onOpenCommandPalette,
  darkMode,
  onToggleDarkMode,
  onNavigate,
  canCreatePosts,
  locale = 'en',
  onToggleLocale,
}) => {
  const { tr } = useAdminLocale();
  // Derive a human-friendly title for the top header based on the current path
  const getPageTitle = () => {
    if (currentPath === "/admin" || currentPath === "/admin/")
      return "Dashboard";
    if (currentPath.startsWith("/admin/posts/new")) return "New Post";
    if (currentPath.startsWith("/admin/posts/drafts")) return "Drafts";
    if (currentPath.startsWith("/admin/posts/review")) return "In review";
    if (currentPath.startsWith("/admin/posts/scheduled")) return "Scheduled";
    if (currentPath.startsWith("/admin/posts/published")) return "Published";
    if (currentPath.startsWith("/admin/posts/")) return "Edit Post";
    if (currentPath.startsWith("/admin/posts")) return "Posts";
    if (currentPath.startsWith("/admin/pages/new")) return "New Page";
    if (currentPath.startsWith("/admin/pages/")) return "Edit Page";
    if (currentPath.startsWith("/admin/pages")) return "Pages";
    if (currentPath.startsWith("/admin/tags")) return "Tags";
    if (currentPath.startsWith("/admin/media")) return "Media Library";
    if (currentPath.startsWith("/admin/members")) return "Members";
    if (currentPath.startsWith("/admin/comments") || currentPath.startsWith("/admin/community"))
      return "Comments";
    if (currentPath.startsWith("/admin/subscriptions")) return "Subscriptions";
    if (currentPath.startsWith("/admin/newsletters")) return "Newsletters";
    if (currentPath.startsWith("/admin/settings/themes")) return "Themes";
    if (currentPath.startsWith("/admin/settings/billing")) return "Billing";
    if (currentPath.startsWith("/admin/settings/storage")) return "Storage";
    if (currentPath.startsWith("/admin/settings/platform")) return "Platform";
    if (currentPath.startsWith("/admin/settings/operations"))
      return "Operations";
    if (currentPath.startsWith("/admin/settings")) return "Settings";
    if (currentPath.startsWith("/admin/plugins")) return "Plugins";
    if (currentPath.startsWith("/admin/analytics")) return "Intelligence";
    return "Vibress Admin";
  };

  return (
    <header className="md:hidden sticky top-0 z-20 flex min-h-14 w-full items-center justify-between gap-2 border-b border-border bg-background/95 backdrop-blur-md px-3">
      {/* Left Section: Hamburger button + Logo */}
      <div className="flex min-w-0 items-center gap-2">
        <IconButton
          label={tr("Toggle navigation menu")}
          onClick={onToggleSidebar}
          variant="outline"
          size="icon-sm"
        >
          <Menu className="size-4" aria-hidden="true" />
        </IconButton>

        <div className="flex min-w-0 items-center gap-2">
          <img
            src={vibressLogo}
            alt=""
            aria-hidden="true"
            className="hidden min-[400px]:block h-5 w-auto object-contain"
          />
          <span className="min-w-0 max-w-[100px] truncate text-sm font-semibold tracking-tight text-foreground min-[400px]:max-w-[170px]">
            {tr(getPageTitle())}
          </span>
        </div>
      </div>

      {/* Right Section: Quick Action + Search + Theme Toggle */}
      <div className="flex shrink-0 items-center gap-1">
        {canCreatePosts && (
          <IconButton
            label={tr("Create new post")}
            onClick={() => onNavigate("/admin/posts/new")}
            variant="default"
            size="icon-sm"
          >
            <Plus className="size-4" aria-hidden="true" />
          </IconButton>
        )}

        <IconButton
          label={tr("Search")}
          onClick={onOpenCommandPalette}
          variant="outline"
          size="icon-sm"
        >
          <Search className="size-4" aria-hidden="true" />
        </IconButton>

        {onToggleLocale && (
          <Button
            variant="outline"
            size="sm"
            onClick={onToggleLocale}
            aria-label={tr("Switch interface language")}
            className="px-2 text-xs"
          >
            {locale === "ar" ? "EN" : "عربي"}
          </Button>
        )}

        <IconButton
          label={tr("Toggle theme")}
          onClick={onToggleDarkMode}
          size="icon-sm"
          className="hidden min-[420px]:inline-flex"
        >
          {darkMode ? (
            <Sun className="size-4 text-amber-400" aria-hidden="true" />
          ) : (
            <Moon className="size-4 text-slate-700" aria-hidden="true" />
          )}
        </IconButton>
      </div>
    </header>
  );
};
