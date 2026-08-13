import React, { useState } from 'react';
import { Bookmark, Code2, ArrowRight, Link2, LucideIcon, Globe } from 'lucide-react';

const ICONS: Record<string, LucideIcon> = {
  bookmark: Bookmark,
  embed: Code2,
};

interface UrlPlaceholderProps {
  iconType: 'bookmark' | 'embed';
  title: string;
  description: string;
  onUrlSubmit: (url: string) => void;
  isSelected?: boolean;
  onClick?: (e: React.MouseEvent) => void;
}

export function UrlPlaceholder({ 
  iconType, title, description, onUrlSubmit, isSelected = false, onClick
}: UrlPlaceholderProps) {
  const Icon = ICONS[iconType] || Bookmark;
  const [url, setUrl] = useState('');

  const handleClick = (e: React.MouseEvent) => {
    if (onClick) onClick(e);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (url.trim()) {
      onUrlSubmit(url.trim());
    }
  };

  const isEmbed = iconType === 'embed';
  const InputIcon = isEmbed ? Link2 : Globe;
  const placeholderText = isEmbed 
    ? 'Paste link to embed (YouTube, Vimeo, Twitter, Figma, Codepen...)' 
    : 'Paste link URL (e.g. https://example.com)...';

  return (
    <div 
      className={`group relative my-3 rounded-xl border border-dashed transition-all duration-200 select-none overflow-hidden ${
        isSelected
          ? 'border-primary ring-2 ring-primary/30 bg-primary/5'
          : 'border-border/80 dark:border-white/10 hover:border-primary/60 bg-muted/30 dark:bg-white/[0.02] hover:bg-muted/60 dark:hover:bg-white/[0.04]'
      }`}
      onClick={handleClick}
    >
      <div className="p-3.5 px-4.5 flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary border border-primary/20 flex items-center justify-center flex-shrink-0 group-hover:scale-105 transition-transform duration-200 shadow-sm">
              <Icon className="w-5 h-5" strokeWidth={1.75} />
            </div>
            <div className="min-w-0">
              <span className="text-sm font-semibold text-foreground tracking-tight">{title}</span>
              <p className="text-xs text-muted-foreground truncate mt-0.5">{description}</p>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="flex gap-2 w-full">
          <div className="relative flex-1">
            <InputIcon className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground group-focus-within:text-primary transition-colors" />
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={placeholderText}
              className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-border/80 bg-background dark:bg-white/[0.05] text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-primary/40 transition"
              required
              onFocus={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
              onKeyUp={(e) => e.stopPropagation()}
              onKeyPress={(e) => e.stopPropagation()}
            />
          </div>
          <button
            type="submit"
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-medium bg-background dark:bg-white/[0.06] border border-border/80 dark:border-white/10 text-foreground hover:border-primary/50 hover:text-primary hover:bg-primary/5 transition-all shadow-sm flex-shrink-0 cursor-pointer"
          >
            <span>{isEmbed ? 'Embed' : 'Save'}</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </form>
      </div>
    </div>
  );
}
