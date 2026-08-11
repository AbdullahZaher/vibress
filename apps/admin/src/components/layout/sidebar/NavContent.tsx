import React, { useState } from 'react';
import { PenLine, ChevronDown, ChevronUp, Plus, File, Tag as TagIcon, Image as ImageIcon, Users, MessageSquare } from 'lucide-react';
import { Badge } from '../../ui/badge';

interface NavContentProps {
  currentPath: string;
  onNavigate: (path: string) => void;
  canPublishPosts: boolean;
}

export const NavContent: React.FC<NavContentProps> = ({
  currentPath,
  onNavigate,
  canPublishPosts,
}) => {
  const [postsExpanded, setPostsExpanded] = useState(true);
  const [isIconHovered, setIsIconHovered] = useState(false);

  const isPostsActive = currentPath.startsWith('/admin/posts');
  const isDraftsActive = currentPath === '/admin/posts/drafts';
  const isScheduledActive = currentPath === '/admin/posts/scheduled';
  const isPublishedActive = currentPath === '/admin/posts/published';

  return (
    <div className="space-y-0.5 text-[13px]">
      {/* Posts Item with Tree Chevron & Quick Plus Create */}
      <div
        className={`group/posts relative flex items-center justify-between px-2.5 py-1.5 rounded-lg transition-colors cursor-pointer ${
          isPostsActive && !postsExpanded
            ? 'bg-sidebar-accent text-foreground font-semibold border border-sidebar-border/60'
            : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-foreground'
        }`}
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {/* PenLine Icon default, changing to Chevron on hover */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setPostsExpanded(!postsExpanded);
            }}
            onMouseEnter={() => setIsIconHovered(true)}
            onMouseLeave={() => setIsIconHovered(false)}
            className="p-1 rounded-md hover:bg-sidebar-accent text-muted-foreground hover:text-foreground transition-all shrink-0 cursor-pointer"
            title={postsExpanded ? "Collapse Posts" : "Expand Posts"}
          >
            {isIconHovered ? (
              postsExpanded ? (
                <ChevronUp className="h-4 w-4 transition-transform duration-200" />
              ) : (
                <ChevronDown className="h-4 w-4 transition-transform duration-200" />
              )
            ) : (
              <PenLine className="h-4 w-4 transition-transform duration-200" />
            )}
          </button>

          {/* Posts Label */}
          <button
            type="button"
            onClick={() => onNavigate('/admin/posts')}
            className="font-medium text-left truncate cursor-pointer flex-1"
          >
            Posts
          </button>
        </div>

        {/* Plus Action Button */}
        {canPublishPosts && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onNavigate('/admin/posts/new');
            }}
            className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-foreground transition-all shrink-0 cursor-pointer"
            title="Create new post"
          >
            <Plus size={15} />
          </button>
        )}
      </div>

      {/* Sub-items Tree Structure under Posts */}
      {postsExpanded && (
        <div className="relative ml-4 pl-3.5 border-l border-sidebar-border/70 space-y-0 text-[12px] my-0.5">
          <button
            type="button"
            onClick={() => onNavigate('/admin/posts/drafts')}
            className={`w-full text-left py-1 px-2 rounded-md transition-colors cursor-pointer block font-medium ${
              isDraftsActive
                ? 'text-foreground font-semibold bg-sidebar-accent/60'
                : 'text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/40'
            }`}
          >
            Drafts
          </button>
          <button
            type="button"
            onClick={() => onNavigate('/admin/posts/scheduled')}
            className={`w-full text-left py-1 px-2 rounded-md transition-colors cursor-pointer block font-medium ${
              isScheduledActive
                ? 'text-foreground font-semibold bg-sidebar-accent/60'
                : 'text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/40'
            }`}
          >
            Scheduled
          </button>
          <button
            type="button"
            onClick={() => onNavigate('/admin/posts/published')}
            className={`w-full text-left py-1 px-2 rounded-md transition-colors cursor-pointer block font-medium ${
              isPublishedActive
                ? 'text-foreground font-semibold bg-sidebar-accent/60'
                : 'text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/40'
            }`}
          >
            Published
          </button>
        </div>
      )}

      {/* Pages */}
      <button
        type="button"
        onClick={() => onNavigate('/admin/pages')}
        className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg font-medium transition-colors cursor-pointer ${
          currentPath.startsWith('/admin/pages')
            ? 'bg-sidebar-accent text-foreground font-semibold border border-sidebar-border/60'
            : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-foreground'
        }`}
      >
        <File className="h-4 w-4 shrink-0" />
        <span>Pages</span>
      </button>

      {/* Tags */}
      <button
        type="button"
        onClick={() => onNavigate('/admin/tags')}
        className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg font-medium transition-colors cursor-pointer ${
          currentPath.startsWith('/admin/tags')
            ? 'bg-sidebar-accent text-foreground font-semibold border border-sidebar-border/60'
            : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-foreground'
        }`}
      >
        <TagIcon className="h-4 w-4 shrink-0" />
        <span>Tags</span>
      </button>

      {/* Media */}
      <button
        type="button"
        onClick={() => onNavigate('/admin/media')}
        className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg font-medium transition-colors cursor-pointer ${
          currentPath.startsWith('/admin/media')
            ? 'bg-sidebar-accent text-foreground font-semibold border border-sidebar-border/60'
            : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-foreground'
        }`}
      >
        <ImageIcon className="h-4 w-4 shrink-0" />
        <span>Media</span>
      </button>

      {/* Members */}
      <button
        type="button"
        onClick={() => onNavigate('/admin/members')}
        className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg font-medium transition-colors cursor-pointer ${
          currentPath.startsWith('/admin/members')
            ? 'bg-sidebar-accent text-foreground font-semibold border border-sidebar-border/60'
            : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-foreground'
        }`}
      >
        <div className="flex items-center gap-2.5">
          <Users className="h-4 w-4 shrink-0" />
          <span>Members</span>
        </div>
        <Badge variant="secondary" className="text-[10px] font-mono py-0 px-1.5 bg-muted text-muted-foreground border-border">
          0
        </Badge>
      </button>

      {/* Comments */}
      <button
        type="button"
        onClick={() => onNavigate('/admin/community')}
        className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg font-medium text-sidebar-foreground hover:bg-sidebar-accent hover:text-foreground transition-colors cursor-pointer"
      >
        <MessageSquare className="h-4 w-4 shrink-0" />
        <span>Comments</span>
      </button>
    </div>
  );
};
