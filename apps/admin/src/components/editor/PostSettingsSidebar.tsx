import React from "react";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import {
  X,
  Calendar,
  Tag as TagIcon,
  Sparkles,
  History,
  RotateCcw,
} from "lucide-react";

interface Tag {
  id: string;
  name: string;
}

interface Revision {
  id: string;
  revisionNumber: number;
  title: string;
  createdAt: string;
}

interface PostSettingsSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  slug: string;
  setSlug: (val: string) => void;
  excerpt: string;
  setExcerpt: (val: string) => void;
  metaTitle: string;
  setMetaTitle: (val: string) => void;
  metaDescription: string;
  setMetaDescription: (val: string) => void;
  canonicalUrl: string;
  setCanonicalUrl: (val: string) => void;
  allTags: Tag[];
  selectedTagIds: string[];
  setSelectedTagIds: (ids: string[]) => void;
  scheduledAtStr: string;
  setScheduledAtStr: (val: string) => void;
  handleSchedule: () => void;
  canPublish: boolean;
  postId?: string;
  revisions: Revision[];
  handleRestoreRevision: (id: string) => void;
}

export const PostSettingsSidebar: React.FC<PostSettingsSidebarProps> = ({
  isOpen,
  onClose,
  slug,
  setSlug,
  excerpt,
  setExcerpt,
  metaTitle,
  setMetaTitle,
  metaDescription,
  setMetaDescription,
  canonicalUrl,
  setCanonicalUrl,
  allTags,
  selectedTagIds,
  setSelectedTagIds,
  scheduledAtStr,
  setScheduledAtStr,
  handleSchedule,
  canPublish,
  postId,
  revisions,
  handleRestoreRevision,
}) => {
  if (!isOpen) return null;

  return (
    <>
      <div
        className="fixed inset-0 bg-background/50 backdrop-blur-sm z-40 transition-opacity"
        onClick={onClose}
      />
      <div className="fixed inset-y-0 right-0 w-80 bg-background border-l shadow-2xl z-50 flex flex-col overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b sticky top-0 bg-background/95 backdrop-blur z-10">
          <h2 className="font-semibold text-sm">Post Settings</h2>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="p-4 space-y-8">
          {/* Basic Meta */}
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-semibold text-muted-foreground">
                URL Slug
              </label>
              <Input
                type="text"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="post-url-slug"
                className="text-sm font-mono h-9"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-semibold text-muted-foreground">
                Excerpt
              </label>
              <textarea
                value={excerpt}
                onChange={(e) => setExcerpt(e.target.value)}
                placeholder="Short summary for preview..."
                className="w-full min-h-[100px] text-sm flex rounded-md border border-input bg-transparent px-3 py-2 shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>
          </div>

          {/* Tags */}
          <div className="space-y-4 border-t pt-6">
            <h3 className="text-sm font-bold flex items-center gap-2">
              <TagIcon className="h-4 w-4 text-primary" /> Tags
            </h3>
            <div className="flex flex-wrap gap-2">
              {allTags.map((tag) => {
                const isSelected = selectedTagIds.includes(tag.id);
                return (
                  <Badge
                    key={tag.id}
                    variant={isSelected ? "default" : "outline"}
                    onClick={() => {
                      if (isSelected) {
                        setSelectedTagIds(
                          selectedTagIds.filter((id) => id !== tag.id),
                        );
                      } else {
                        setSelectedTagIds([...selectedTagIds, tag.id]);
                      }
                    }}
                    className="cursor-pointer py-1 px-3 text-xs"
                  >
                    {tag.name}
                  </Badge>
                );
              })}
            </div>
          </div>

          {/* SEO Meta */}
          <div className="space-y-4 border-t pt-6">
            <h3 className="text-sm font-bold flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" /> Meta Data
            </h3>
            <div className="space-y-2">
              <label className="text-xs font-semibold text-muted-foreground">
                Meta Title
              </label>
              <Input
                type="text"
                value={metaTitle}
                onChange={(e) => setMetaTitle(e.target.value)}
                placeholder="Title for Search Engines"
                className="text-sm h-9"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-semibold text-muted-foreground">
                Meta Description
              </label>
              <textarea
                value={metaDescription}
                onChange={(e) => setMetaDescription(e.target.value)}
                placeholder="Search engine description..."
                className="w-full min-h-[80px] text-sm flex rounded-md border border-input bg-transparent px-3 py-2 shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-semibold text-muted-foreground">
                Canonical URL
              </label>
              <Input
                type="text"
                value={canonicalUrl}
                onChange={(e) => setCanonicalUrl(e.target.value)}
                placeholder="https://..."
                className="text-sm font-mono h-9"
              />
            </div>
          </div>

          {/* Schedule */}
          {postId && canPublish && (
            <div className="space-y-4 border-t pt-6">
              <h3 className="text-sm font-bold flex items-center gap-2">
                <Calendar className="h-4 w-4 text-amber-500" /> Publish Date
              </h3>
              <div className="flex flex-col gap-3">
                <Input
                  type="datetime-local"
                  value={scheduledAtStr}
                  onChange={(e) => setScheduledAtStr(e.target.value)}
                  className="text-sm h-9"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSchedule}
                  className="text-sm w-full"
                >
                  Schedule
                </Button>
              </div>
            </div>
          )}

          {/* Revisions History */}
          {postId && revisions.length > 0 && (
            <div className="space-y-4 border-t pt-6">
              <h3 className="text-sm font-bold flex items-center gap-2">
                <History className="h-4 w-4 text-indigo-500" /> History
              </h3>
              <div className="space-y-2">
                {revisions.map((rev) => (
                  <div
                    key={rev.id}
                    className="flex flex-col gap-2 p-3 rounded-lg border bg-muted/20 text-xs"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold">
                        Version #{rev.revisionNumber}
                      </span>
                      <span className="text-muted-foreground">
                        {new Date(rev.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRestoreRevision(rev.id)}
                      className="h-7 text-xs gap-1 w-full justify-center bg-background border"
                    >
                      <RotateCcw className="h-3 w-3" /> Restore Version
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
};
