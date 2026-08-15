import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  Search,
  PenLine,
  File,
  Tag as TagIcon,
  Image as ImageIcon,
  Users,
  MessageSquare,
  TrendingUp,
  Sun,
  Moon,
  ExternalLink,
  LogOut,
  Palette,
  CreditCard,
  Mail,
  Sliders,
  Activity,
  Plus,
  X,
} from 'lucide-react';

export interface CommandItem {
  id: string;
  title: string;
  description?: string;
  category: 'Content' | 'Navigation' | 'Settings' | 'Actions';
  icon: React.ReactNode;
  keywords?: string[];
  action: () => void;
}

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (path: string) => void;
  onToggleDarkMode: () => void;
  darkMode: boolean;
  onLogout: () => void;
  canPublishPosts: boolean;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen,
  onClose,
  onNavigate,
  onToggleDarkMode,
  darkMode,
  onLogout,
  canPublishPosts,
}) => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const items: CommandItem[] = useMemo(() => {
    const list: CommandItem[] = [
      // Actions
      ...(canPublishPosts
        ? [
            {
              id: 'action-new-post',
              title: 'Create New Post',
              description: 'Write a new blog article or story',
              category: 'Actions' as const,
              icon: <Plus className="h-4 w-4 text-emerald-500" />,
              keywords: ['new', 'post', 'write', 'article', 'create', 'blog'],
              action: () => onNavigate('/admin/posts/new'),
            },
            {
              id: 'action-new-page',
              title: 'Create New Page',
              description: 'Create a standalone static page',
              category: 'Actions' as const,
              icon: <Plus className="h-4 w-4 text-sky-500" />,
              keywords: ['new', 'page', 'create', 'static'],
              action: () => onNavigate('/admin/pages/new'),
            },
          ]
        : []),
      {
        id: 'action-theme-toggle',
        title: darkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode',
        description: 'Toggle interface visual theme',
        category: 'Actions' as const,
        icon: darkMode ? <Sun className="h-4 w-4 text-amber-400" /> : <Moon className="h-4 w-4 text-slate-700" />,
        keywords: ['dark', 'light', 'theme', 'mode', 'color'],
        action: onToggleDarkMode,
      },
      {
        id: 'action-view-site',
        title: 'View Live Site',
        description: 'Open public website in a new tab',
        category: 'Actions' as const,
        icon: <ExternalLink className="h-4 w-4 text-blue-400" />,
        keywords: ['view', 'site', 'website', 'live', 'public', 'open'],
        action: () => window.open('/', '_blank'),
      },

      // Navigation & Content
      {
        id: 'nav-analytics',
        title: 'Analytics Dashboard',
        description: 'Overview of visitors, traffic, and growth',
        category: 'Navigation' as const,
        icon: <TrendingUp className="h-4 w-4 text-indigo-400" />,
        keywords: ['analytics', 'stats', 'traffic', 'dashboard', 'views', 'metrics'],
        action: () => onNavigate('/admin'),
      },
      {
        id: 'content-posts',
        title: 'All Posts',
        description: 'Manage articles, stories, and publications',
        category: 'Content' as const,
        icon: <PenLine className="h-4 w-4 text-emerald-400" />,
        keywords: ['posts', 'articles', 'content', 'stories', 'list'],
        action: () => onNavigate('/admin/posts'),
      },
      {
        id: 'content-drafts',
        title: 'Draft Posts',
        description: 'View and edit unpublished drafts',
        category: 'Content' as const,
        icon: <PenLine className="h-4 w-4 text-amber-400" />,
        keywords: ['drafts', 'unpublished', 'wip'],
        action: () => onNavigate('/admin/posts/drafts'),
      },
      {
        id: 'content-scheduled',
        title: 'Scheduled Posts',
        description: 'Posts queued for automatic publication',
        category: 'Content' as const,
        icon: <PenLine className="h-4 w-4 text-blue-400" />,
        keywords: ['scheduled', 'queue', 'future', 'calendar'],
        action: () => onNavigate('/admin/posts/scheduled'),
      },
      {
        id: 'content-published',
        title: 'Published Posts',
        description: 'Live posts visible on your website',
        category: 'Content' as const,
        icon: <PenLine className="h-4 w-4 text-green-400" />,
        keywords: ['published', 'live', 'visible'],
        action: () => onNavigate('/admin/posts/published'),
      },
      {
        id: 'content-pages',
        title: 'Pages',
        description: 'Manage static pages (About, Contact, Terms)',
        category: 'Content' as const,
        icon: <File className="h-4 w-4 text-cyan-400" />,
        keywords: ['pages', 'static', 'about', 'contact'],
        action: () => onNavigate('/admin/pages'),
      },
      {
        id: 'content-tags',
        title: 'Tags Manager',
        description: 'Organize content with tags and categories',
        category: 'Content' as const,
        icon: <TagIcon className="h-4 w-4 text-rose-400" />,
        keywords: ['tags', 'categories', 'labels', 'topics'],
        action: () => onNavigate('/admin/tags'),
      },
      {
        id: 'content-media',
        title: 'Media Library',
        description: 'Upload and manage images, video, and audio files',
        category: 'Content' as const,
        icon: <ImageIcon className="h-4 w-4 text-violet-400" />,
        keywords: ['media', 'images', 'photos', 'videos', 'assets', 'files', 'upload'],
        action: () => onNavigate('/admin/media'),
      },
      {
        id: 'content-members',
        title: 'Members & Subscribers',
        description: 'Manage registered members and email subscribers',
        category: 'Content' as const,
        icon: <Users className="h-4 w-4 text-teal-400" />,
        keywords: ['members', 'users', 'subscribers', 'audience', 'crm', 'emails'],
        action: () => onNavigate('/admin/members'),
      },
      {
        id: 'content-comments',
        title: 'Community & Comments',
        description: 'Moderate member discussions and comments',
        category: 'Content' as const,
        icon: <MessageSquare className="h-4 w-4 text-pink-400" />,
        keywords: ['comments', 'community', 'moderation', 'feedback', 'discussions'],
        action: () => onNavigate('/admin/community'),
      },

      // Settings (5 Core Pillars)
      {
        id: 'settings-general',
        title: 'General Settings',
        description: 'Publication info, locale, language, and publishing defaults',
        category: 'Settings' as const,
        icon: <Sliders className="h-4 w-4 text-sky-400" />,
        keywords: ['general', 'settings', 'title', 'tagline', 'locale', 'language', 'site', 'config'],
        action: () => onNavigate('/admin/settings/general'),
      },
      {
        id: 'settings-site',
        title: 'Site Settings (Themes & Storage)',
        description: 'Customize themes, design styling, and asset storage',
        category: 'Settings' as const,
        icon: <Palette className="h-4 w-4 text-orange-400" />,
        keywords: ['site', 'themes', 'theme', 'design', 'appearance', 'storage', 's3', 'media', 'css'],
        action: () => onNavigate('/admin/settings/site'),
      },
      {
        id: 'settings-membership',
        title: 'Membership Settings (Tiers & Access)',
        description: 'Stripe payments, subscription tiers, and member access rules',
        category: 'Settings' as const,
        icon: <CreditCard className="h-4 w-4 text-emerald-400" />,
        keywords: ['membership', 'billing', 'stripe', 'plans', 'subscriptions', 'access', 'pricing', 'payments'],
        action: () => onNavigate('/admin/settings/membership'),
      },
      {
        id: 'settings-growth',
        title: 'Growth Settings (Newsletters & Analytics)',
        description: 'Email newsletters, predictive intelligence, and community',
        category: 'Settings' as const,
        icon: <Mail className="h-4 w-4 text-yellow-400" />,
        keywords: ['growth', 'newsletter', 'email', 'analytics', 'intelligence', 'community', 'broadcast', 'smtp'],
        action: () => onNavigate('/admin/settings/growth'),
      },
      {
        id: 'settings-advanced',
        title: 'Advanced Settings (Platform & Operations)',
        description: 'API keys, webhooks, plugins SDK, system diagnostics, and audit logs',
        category: 'Settings' as const,
        icon: <Activity className="h-4 w-4 text-purple-400" />,
        keywords: ['advanced', 'platform', 'api', 'keys', 'webhooks', 'plugins', 'operations', 'logs', 'audit', 'health'],
        action: () => onNavigate('/admin/settings/advanced'),
      },

      // Auth Action
      {
        id: 'action-logout',
        title: 'Sign Out',
        description: 'End your current admin session securely',
        category: 'Actions' as const,
        icon: <LogOut className="h-4 w-4 text-rose-500" />,
        keywords: ['logout', 'signout', 'exit', 'leave'],
        action: onLogout,
      },
    ];

    return list;
  }, [canPublishPosts, darkMode, onNavigate, onToggleDarkMode, onLogout]);

  // Filter items by search query
  const filteredItems = useMemo(() => {
    if (!query.trim()) return items;
    const q = query.toLowerCase().trim();
    return items.filter((item) => {
      const matchTitle = item.title.toLowerCase().includes(q);
      const matchDesc = item.description?.toLowerCase().includes(q);
      const matchKeywords = item.keywords?.some((k) => k.toLowerCase().includes(q));
      return matchTitle || matchDesc || matchKeywords;
    });
  }, [items, query]);

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) {
      setQuery('');
      setSelectedIndex(0);
      return;
    }

    const timer = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, [isOpen]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Scroll active item into view
  useEffect(() => {
    if (!listRef.current) return;
    const selectedEl = listRef.current.children[selectedIndex] as HTMLElement;
    if (selectedEl) {
      selectedEl.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % Math.max(1, filteredItems.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + filteredItems.length) % Math.max(1, filteredItems.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredItems[selectedIndex]) {
        filteredItems[selectedIndex].action();
        onClose();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  if (!isOpen || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-16 sm:pt-24 px-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl rounded-2xl bg-card border border-border/90 shadow-2xl overflow-hidden flex flex-col max-h-[75vh] animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Search Input Bar */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-border bg-muted/20">
          <Search className="h-5 w-5 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search commands, actions, settings..."
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="text-muted-foreground hover:text-foreground p-1 rounded-sm cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          <kbd className="hidden sm:inline-block px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground bg-muted border border-border rounded">
            ESC
          </kbd>
        </div>

        {/* Results List */}
        <div className="overflow-y-auto p-2 space-y-1 flex-1">
          {filteredItems.length === 0 ? (
            <div className="p-8 text-center text-xs text-muted-foreground">
              No matching commands found for <span className="font-semibold text-foreground">&quot;{query}&quot;</span>
            </div>
          ) : (
            filteredItems.map((item, idx) => {
              const isSelected = idx === selectedIndex;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    item.action();
                    onClose();
                  }}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={`w-full flex items-center justify-between p-2.5 rounded-xl text-left text-xs transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-primary text-primary-foreground font-medium'
                      : 'text-foreground hover:bg-muted/50'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className={isSelected ? 'text-primary-foreground' : 'text-muted-foreground'}>
                      {item.icon}
                    </span>
                    <div className="truncate">
                      <p className="truncate font-medium">{item.title}</p>
                      {item.description && (
                        <p
                          className={`text-[11px] truncate ${
                            isSelected ? 'text-primary-foreground/80' : 'text-muted-foreground'
                          }`}
                        >
                          {item.description}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0 ml-2">
                    <span
                      className={`text-[10px] capitalize px-1.5 py-0.5 rounded ${
                        isSelected
                          ? 'bg-primary-foreground/20 text-primary-foreground'
                          : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {item.category}
                    </span>
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Footer shortcuts hint */}
        <div className="flex items-center justify-between px-4 py-2 border-t border-border/60 bg-muted/10 text-[11px] text-muted-foreground">
          <div className="flex items-center gap-2">
            <span>Navigation:</span>
            <kbd className="bg-muted px-1 rounded border border-border">↑</kbd>
            <kbd className="bg-muted px-1 rounded border border-border">↓</kbd>
            <span>Select:</span>
            <kbd className="bg-muted px-1.5 rounded border border-border">↵</kbd>
          </div>
          <span>Vibress Fast Command Bar</span>
        </div>
      </div>
    </div>,
    document.body
  );
};
