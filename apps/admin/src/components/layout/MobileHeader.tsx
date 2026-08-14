import React from 'react';
import { Menu, Sun, Moon, Search, Plus } from 'lucide-react';
import vibressLogo from '../../assets/images/vibress-logo.png';

interface MobileHeaderProps {
  currentPath: string;
  onToggleSidebar: () => void;
  onOpenCommandPalette: () => void;
  darkMode: boolean;
  onToggleDarkMode: () => void;
  onNavigate: (path: string) => void;
  canPublishPosts: boolean;
}

export const MobileHeader: React.FC<MobileHeaderProps> = ({
  currentPath,
  onToggleSidebar,
  onOpenCommandPalette,
  darkMode,
  onToggleDarkMode,
  onNavigate,
  canPublishPosts,
}) => {
  // Derive a human-friendly title for the top header based on the current path
  const getPageTitle = () => {
    if (currentPath === '/admin' || currentPath === '/admin/') return 'Analytics';
    if (currentPath.startsWith('/admin/posts/new')) return 'New Post';
    if (currentPath.startsWith('/admin/posts/drafts')) return 'Drafts';
    if (currentPath.startsWith('/admin/posts/scheduled')) return 'Scheduled';
    if (currentPath.startsWith('/admin/posts/published')) return 'Published';
    if (currentPath.startsWith('/admin/posts/')) return 'Edit Post';
    if (currentPath.startsWith('/admin/posts')) return 'Posts';
    if (currentPath.startsWith('/admin/pages/new')) return 'New Page';
    if (currentPath.startsWith('/admin/pages/')) return 'Edit Page';
    if (currentPath.startsWith('/admin/pages')) return 'Pages';
    if (currentPath.startsWith('/admin/tags')) return 'Tags';
    if (currentPath.startsWith('/admin/media')) return 'Media Library';
    if (currentPath.startsWith('/admin/members')) return 'Members';
    if (currentPath.startsWith('/admin/community')) return 'Comments';
    if (currentPath.startsWith('/admin/subscriptions')) return 'Subscriptions';
    if (currentPath.startsWith('/admin/newsletters')) return 'Newsletters';
    if (currentPath.startsWith('/admin/settings/themes')) return 'Themes';
    if (currentPath.startsWith('/admin/settings/billing')) return 'Billing';
    if (currentPath.startsWith('/admin/settings/storage')) return 'Storage';
    if (currentPath.startsWith('/admin/settings/platform')) return 'Platform';
    if (currentPath.startsWith('/admin/settings/operations')) return 'Operations';
    if (currentPath.startsWith('/admin/analytics')) return 'Intelligence';
    return 'Vibress Admin';
  };

  return (
    <header className="md:hidden sticky top-0 z-20 flex h-14 w-full items-center justify-between border-b border-border bg-background/95 backdrop-blur-md px-3.5 shadow-xs">
      {/* Left Section: Hamburger button + Logo */}
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={onToggleSidebar}
          className="flex size-9 items-center justify-center rounded-lg border border-border/80 bg-muted/40 text-foreground hover:bg-muted transition-colors cursor-pointer"
          aria-label="Toggle navigation menu"
          title="Open menu"
        >
          <Menu className="h-4 w-4" />
        </button>

        <div
          className="flex items-center gap-2 cursor-pointer"
          onClick={() => onNavigate('/admin')}
        >
          <img src={vibressLogo} alt="Vibress" className="h-5 w-auto object-contain" />
          <span className="font-semibold text-sm tracking-tight text-foreground truncate max-w-[120px]">
            {getPageTitle()}
          </span>
        </div>
      </div>

      {/* Right Section: Quick Action + Search + Theme Toggle */}
      <div className="flex items-center gap-1.5">
        {canPublishPosts && (
          <button
            type="button"
            onClick={() => onNavigate('/admin/posts/new')}
            className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer"
            title="Create new post"
            aria-label="Create new post"
          >
            <Plus className="h-4 w-4" />
          </button>
        )}

        <button
          type="button"
          onClick={onOpenCommandPalette}
          className="flex size-8 items-center justify-center rounded-lg border border-border/60 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
          title="Search / Command Palette"
          aria-label="Search"
        >
          <Search className="h-4 w-4" />
        </button>

        <button
          type="button"
          onClick={onToggleDarkMode}
          className="flex size-8 items-center justify-center rounded-lg border border-border/60 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
          title="Toggle theme"
          aria-label="Toggle theme"
        >
          {darkMode ? <Sun className="h-3.5 w-3.5 text-amber-400" /> : <Moon className="h-3.5 w-3.5 text-slate-700" />}
        </button>
      </div>
    </header>
  );
};
