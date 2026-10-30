import React, { useEffect, useState } from "react";
import { usePublicationLocales } from "../../../lib/usePublicationLocales";
import { useAdminLocale } from "../../../lib/admin-locale";
import {
  ChevronDown,
  Plus,
  File,
  Tag as TagIcon,
  Image as ImageIcon,
  Users,
  MessageSquare,
  Globe,
} from "lucide-react";

interface NavContentProps {
  currentPath: string;
  onNavigate: (path: string) => void;
  canCreatePosts: boolean;
  canReadTranslations: boolean;
}

export const NavContent: React.FC<NavContentProps> = ({
  currentPath,
  onNavigate,
  canCreatePosts,
  canReadTranslations,
}) => {
  const { data: localePolicy } = usePublicationLocales();
  const { tr } = useAdminLocale();
  const [postsExpanded, setPostsExpanded] = useState(true);

  const isPostsActive = currentPath.startsWith("/admin/posts");
  useEffect(() => {
    if (["/admin/posts/drafts", "/admin/posts/review", "/admin/posts/scheduled", "/admin/posts/published"].includes(currentPath)) {
      setPostsExpanded(true);
    }
  }, [currentPath]);
  const isDraftsActive = currentPath === "/admin/posts/drafts";
  const isReviewActive = currentPath === "/admin/posts/review";
  const isScheduledActive = currentPath === "/admin/posts/scheduled";
  const isPublishedActive = currentPath === "/admin/posts/published";

  return (
    <nav aria-label={tr("Content")} className="space-y-0.5 text-sm">
      <p className="px-2.5 pb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{tr("Content")}</p>
      {/* Posts Item with Tree Chevron & Quick Plus Create */}
      <div
        className={`group/posts relative flex items-center justify-between px-2.5 py-2.5 rounded-lg transition-colors ${
          isPostsActive
            ? "bg-sidebar-accent text-foreground font-semibold border border-sidebar-border/60"
            : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-foreground"
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
            aria-label={postsExpanded ? tr("Collapse Posts") : tr("Expand Posts")}
            aria-expanded={postsExpanded}
            className="flex size-8 items-center justify-center rounded-md hover:bg-sidebar-accent text-muted-foreground hover:text-foreground transition-all shrink-0 cursor-pointer"
            title={postsExpanded ? tr("Collapse Posts") : tr("Expand Posts")}
          >
            <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${postsExpanded ? "" : "-rotate-90 rtl:rotate-90"}`} />
          </button>

          {/* Posts Label */}
          <button
            type="button"
            onClick={() => onNavigate("/admin/posts")}
            aria-current={currentPath === "/admin/posts" ? "page" : undefined}
            className="font-medium text-start truncate cursor-pointer flex-1"
          >
            {tr("Posts")}
          </button>
        </div>

        {/* Plus Action Button */}
        {canCreatePosts && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onNavigate("/admin/posts/new");
            }}
            aria-label={tr("Create new post")}
            className="flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-foreground transition-all shrink-0 cursor-pointer"
            title="Create new post"
          >
            <Plus size={15} />
          </button>
        )}
      </div>

      {/* Sub-items Tree Structure under Posts */}
      {postsExpanded && (
        <div className="relative ms-4 ps-3.5 border-s border-sidebar-border/70 space-y-0 text-[13px] my-0.5">
          <button
            type="button"
            onClick={() => onNavigate("/admin/posts/drafts")}
            aria-current={isDraftsActive ? "page" : undefined}
            className={`w-full text-start py-2 px-2 rounded-md transition-colors cursor-pointer block font-medium ${
              isDraftsActive
                ? "text-foreground font-semibold bg-sidebar-accent/60"
                : "text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/40"
            }`}
          >
            {tr("Drafts")}
          </button>
          <button
            type="button"
            onClick={() => onNavigate("/admin/posts/review")}
            aria-current={isReviewActive ? "page" : undefined}
            className={`w-full text-start py-2 px-2 rounded-md transition-colors cursor-pointer block font-medium ${
              isReviewActive
                ? "text-foreground font-semibold bg-sidebar-accent/60"
                : "text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/40"
            }`}
          >
            {tr("In review")}
          </button>
          <button
            type="button"
            onClick={() => onNavigate("/admin/posts/scheduled")}
            aria-current={isScheduledActive ? "page" : undefined}
            className={`w-full text-start py-2 px-2 rounded-md transition-colors cursor-pointer block font-medium ${
              isScheduledActive
                ? "text-foreground font-semibold bg-sidebar-accent/60"
                : "text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/40"
            }`}
          >
            {tr("Scheduled")}
          </button>
          <button
            type="button"
            onClick={() => onNavigate("/admin/posts/published")}
            aria-current={isPublishedActive ? "page" : undefined}
            className={`w-full text-start py-2 px-2 rounded-md transition-colors cursor-pointer block font-medium ${
              isPublishedActive
                ? "text-foreground font-semibold bg-sidebar-accent/60"
                : "text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/40"
            }`}
          >
            {tr("Published")}
          </button>
        </div>
      )}

      {/* Pages */}
      <button
        type="button"
        onClick={() => onNavigate("/admin/pages")}
            aria-current={currentPath.startsWith("/admin/pages") ? "page" : undefined}
        className={`w-full flex items-center gap-2.5 px-2.5 py-2.5 rounded-lg font-medium transition-colors cursor-pointer ${
          currentPath.startsWith("/admin/pages")
            ? "bg-sidebar-accent text-foreground font-semibold border border-sidebar-border/60"
            : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-foreground"
        }`}
      >
        <File className="h-4 w-4 shrink-0" />
        <span>{tr("Pages")}</span>
      </button>

      {/* Translations & Localization */}
      {localePolicy?.isMultilingual && canReadTranslations && (
      <button
        type="button"
        onClick={() => onNavigate("/admin/translations")}
            aria-current={currentPath.startsWith("/admin/translations") ? "page" : undefined}
        className={`w-full flex items-center gap-2.5 px-2.5 py-2.5 rounded-lg font-medium transition-colors cursor-pointer ${
          currentPath.startsWith("/admin/translations")
            ? "bg-sidebar-accent text-foreground font-semibold border border-sidebar-border/60"
            : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-foreground"
        }`}
      >
        <Globe className="h-4 w-4 shrink-0" />
        <span>{tr("Translations")}</span>
      </button>

      )}
      {/* Tags */}
      <button
        type="button"
        onClick={() => onNavigate("/admin/tags")}
            aria-current={currentPath.startsWith("/admin/tags") ? "page" : undefined}
        className={`w-full flex items-center gap-2.5 px-2.5 py-2.5 rounded-lg font-medium transition-colors cursor-pointer ${
          currentPath.startsWith("/admin/tags")
            ? "bg-sidebar-accent text-foreground font-semibold border border-sidebar-border/60"
            : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-foreground"
        }`}
      >
        <TagIcon className="h-4 w-4 shrink-0" />
        <span>{tr("Tags")}</span>
      </button>

      {/* Media */}
      <button
        type="button"
        onClick={() => onNavigate("/admin/media")}
            aria-current={currentPath.startsWith("/admin/media") ? "page" : undefined}
        className={`w-full flex items-center gap-2.5 px-2.5 py-2.5 rounded-lg font-medium transition-colors cursor-pointer ${
          currentPath.startsWith("/admin/media")
            ? "bg-sidebar-accent text-foreground font-semibold border border-sidebar-border/60"
            : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-foreground"
        }`}
      >
        <ImageIcon className="h-4 w-4 shrink-0" />
        <span>{tr("Media")}</span>
      </button>

      {/* Members */}
      <button
        type="button"
        onClick={() => onNavigate("/admin/members")}
            aria-current={currentPath.startsWith("/admin/members") ? "page" : undefined}
        className={`w-full flex items-center gap-2.5 px-2.5 py-2.5 rounded-lg font-medium transition-colors cursor-pointer ${
          currentPath.startsWith("/admin/members")
            ? "bg-sidebar-accent text-foreground font-semibold border border-sidebar-border/60"
            : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-foreground"
        }`}
      >
        <Users className="h-4 w-4 shrink-0" />
        <span>{tr("Members")}</span>
      </button>

      {/* Comments & Moderation */}
      <button
        type="button"
        onClick={() => onNavigate("/admin/comments")}
            aria-current={currentPath.startsWith("/admin/comments") ? "page" : undefined}
        className={`w-full flex items-center gap-2.5 px-2.5 py-2.5 rounded-lg font-medium transition-colors cursor-pointer ${
          currentPath.startsWith("/admin/comments")
            ? "bg-sidebar-accent text-foreground font-semibold border border-sidebar-border/60"
            : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-foreground"
        }`}
      >
        <MessageSquare className="h-4 w-4 shrink-0" />
        <span>{tr("Comments")}</span>
      </button>
    </nav>
  );
};

