import React, { useEffect, useId, useState } from "react";
import { ChevronDown, Plus, File, Tag, Image as ImageIcon, Users, MessageSquare, Globe } from "lucide-react";
import { usePublicationLocales } from "../../../lib/usePublicationLocales";
import { useAdminLocale } from "../../../lib/admin-locale";

interface NavContentProps {
  currentPath: string;
  onNavigate: (path: string) => void;
  canCreatePosts: boolean;
  canReadPosts: boolean;
  canReadPages: boolean;
  canReadTags: boolean;
  canReadMedia: boolean;
  canReadMembers: boolean;
  canReadComments: boolean;
  canReadTranslations: boolean;
}

const activeClass = "bg-sidebar-accent text-foreground font-semibold border-s-2 border-primary shadow-2xs";
const inactiveClass = "text-sidebar-foreground hover:bg-sidebar-accent hover:text-foreground";
const linkClass = "flex min-h-10 w-full items-center gap-3 rounded-lg px-2.5 py-2 text-start font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring cursor-pointer";

export const NavContent: React.FC<NavContentProps> = ({
  currentPath,
  onNavigate,
  canCreatePosts,
  canReadPosts,
  canReadPages,
  canReadTags,
  canReadMedia,
  canReadMembers,
  canReadComments,
  canReadTranslations,
}) => {
  const { data: localePolicy } = usePublicationLocales();
  const { tr } = useAdminLocale();
  const postLinksId = useId();
  const [postsExpanded, setPostsExpanded] = useState(true);

  useEffect(() => {
    if (currentPath.startsWith("/admin/posts/")) setPostsExpanded(true);
  }, [currentPath]);

  const contentLinks = [
    { path: "/admin/pages", label: "Pages", icon: File, visible: canReadPages },
    { path: "/admin/translations", label: "Translations", icon: Globe, visible: canReadTranslations && Boolean(localePolicy?.isMultilingual) },
    { path: "/admin/tags", label: "Tags", icon: Tag, visible: canReadTags },
    { path: "/admin/media", label: "Media", icon: ImageIcon, visible: canReadMedia },
    { path: "/admin/members", label: "Members", icon: Users, visible: canReadMembers },
    { path: "/admin/comments", label: "Comments", icon: MessageSquare, visible: canReadComments },
  ];

  const postLinks = [
    { path: "/admin/posts/drafts", label: "Drafts" },
    { path: "/admin/posts/review", label: "In review" },
    { path: "/admin/posts/scheduled", label: "Scheduled" },
    { path: "/admin/posts/published", label: "Published" },
  ];

  return (
    <nav aria-label={tr("Content")} className="space-y-0.5 text-sm">
      <p className="px-2.5 pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{tr("Content")}</p>

      {canReadPosts && (
        <>
          <div className={`flex min-h-11 items-center gap-1 rounded-lg px-1.5 transition-colors ${currentPath.startsWith("/admin/posts") ? activeClass : inactiveClass}`}>
            <button
              type="button"
              onClick={() => setPostsExpanded((expanded) => !expanded)}
              aria-label={postsExpanded ? tr("Collapse Posts") : tr("Expand Posts")}
              aria-expanded={postsExpanded}
              aria-controls={postLinksId}
              className="flex size-10 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent focus-visible:outline-2 focus-visible:outline-ring"
            >
              <ChevronDown className={`size-4 transition-transform ${postsExpanded ? "" : "-rotate-90 rtl:rotate-90"}`} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => onNavigate("/admin/posts")}
              aria-current={currentPath === "/admin/posts" ? "page" : undefined}
              className="min-h-11 min-w-0 flex-1 truncate rounded-md text-start font-medium focus-visible:outline-2 focus-visible:outline-ring"
            >
              {tr("Posts")}
            </button>
            {canCreatePosts && (
              <button
                type="button"
                onClick={() => onNavigate("/admin/posts/new")}
                aria-label={tr("Create new post")}
                title={tr("Create new post")}
                className="flex size-10 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent focus-visible:outline-2 focus-visible:outline-ring"
              >
                <Plus className="size-4" aria-hidden="true" />
              </button>
            )}
          </div>

          {postsExpanded && (
            <div id={postLinksId} className="my-1 ms-5 space-y-0.5 border-s border-sidebar-border ps-3">
              {postLinks.map((item) => (
                <button
                  key={item.path}
                  type="button"
                  onClick={() => onNavigate(item.path)}
                  aria-current={currentPath === item.path ? "page" : undefined}
                  className={`min-h-10 w-full rounded-md px-2 text-start text-[13px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring ${currentPath === item.path ? "bg-sidebar-accent/60 font-semibold text-foreground" : "text-muted-foreground hover:bg-sidebar-accent/40 hover:text-foreground"}`}
                >
                  {tr(item.label)}
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {contentLinks.filter((item) => item.visible).map((item) => {
        const Icon = item.icon;
        const isActive = currentPath === item.path || currentPath.startsWith(`${item.path}/`);
        return (
          <button
            key={item.path}
            type="button"
            onClick={() => onNavigate(item.path)}
            aria-current={isActive ? "page" : undefined}
            className={`${linkClass} ${isActive ? activeClass : inactiveClass}`}
          >
            <Icon className="size-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0 truncate">{tr(item.label)}</span>
          </button>
        );
      })}
    </nav>
  );
};
