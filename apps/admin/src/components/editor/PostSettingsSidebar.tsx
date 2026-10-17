import React, { useState } from "react";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { generateAiCompletion } from "../../lib/api";
import {
  X,
  Calendar,
  Tag as TagIcon,
  Sparkles,
  History,
  RotateCcw,
} from "lucide-react";
import { TranslationSidebarSection } from "../translations/TranslationSidebarSection";
import { useAdminLocale } from "../../lib/admin-locale";

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
  postTitle?: string | undefined;
  contentContext?: string | undefined;
  featured: boolean;
  setFeatured: (value: boolean) => void;
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
  postId?: string | undefined;
  revisions: Revision[];
  handleRestoreRevision: (id: string) => void;
  onNavigate?: ((path: string) => void) | undefined;
}

export const PostSettingsSidebar: React.FC<PostSettingsSidebarProps> = ({
  isOpen,
  onClose,
  postTitle,
  contentContext,
  featured,
  setFeatured,
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
  onNavigate,
}) => {
  const { tr } = useAdminLocale();
  const [generatingSeo, setGeneratingSeo] = useState(false);

  const handleGenerateSeoWithAi = async () => {
    if (!postTitle && !slug) return;
    setGeneratingSeo(true);
    try {
      const resText = await generateAiCompletion({
        prompt: postTitle || slug,
        context: contentContext || excerpt,
        task: "seo",
      });
      const parsed = JSON.parse(resText);
      if (parsed.metaTitle) setMetaTitle(parsed.metaTitle);
      if (parsed.metaDescription) setMetaDescription(parsed.metaDescription);
    } catch {
      if (postTitle && !metaTitle) setMetaTitle(postTitle);
      if (excerpt && !metaDescription) setMetaDescription(excerpt);
    } finally {
      setGeneratingSeo(false);
    }
  };
  if (!isOpen) return null;

  return (
    <>
      <div
        className="fixed inset-0 bg-background/60 backdrop-blur-xs z-40 transition-opacity animate-in fade-in duration-150"
        onClick={onClose}
      />
      <div className="fixed inset-y-0 end-0 w-88 max-w-[90vw] bg-card border-s border-border shadow-2xl z-50 flex flex-col overflow-y-auto animate-in ltr:slide-in-from-right rtl:slide-in-from-left duration-200">
        <div className="flex items-center justify-between p-4 border-b border-border sticky top-0 bg-card/95 backdrop-blur z-10">
          <div>
            <h2 className="font-semibold text-sm text-foreground">{tr("Post Settings")}</h2>
            <p className="text-[11px] text-muted-foreground">{tr("Manage publication, metadata and SEO")}</p>
          </div>
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
                {tr("URL Slug")}
              </label>
              <Input
                type="text"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder={tr("post-url-slug")}
                className="text-sm font-mono h-9"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-semibold text-muted-foreground">
                {tr("Excerpt")}
              </label>
              <textarea
                value={excerpt}
                onChange={(e) => setExcerpt(e.target.value)}
                placeholder={tr("Short summary for preview...")}
                className="w-full min-h-[100px] text-sm flex rounded-md border border-input bg-transparent px-3 py-2 shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>
          </div>

          {/* Featured flag is independent of the feature image. */}
          <div className="border-t pt-6">
            <label htmlFor="post-featured" className="flex cursor-pointer items-center justify-between gap-4">
              <span className="space-y-1">
                <span className="block text-sm font-semibold">{tr("Feature this post")}</span>
                <span className="block text-xs text-muted-foreground">{tr("Allow themes to highlight this post when published.")}</span>
              </span>
              <input
                id="post-featured"
                type="checkbox"
                checked={featured}
                onChange={(event) => setFeatured(event.target.checked)}
                className="h-4 w-4 shrink-0 accent-primary"
              />
            </label>
          </div>

          {/* Tags */
          <div className="space-y-4 border-t pt-6">
            <h3 className="text-sm font-bold flex items-center gap-2">
              <TagIcon className="h-4 w-4 text-primary" /> {tr("Tags")}
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
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" /> {tr("Meta Data")}
              </h3>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs gap-1"
                onClick={handleGenerateSeoWithAi}
                disabled={generatingSeo}
              >
                <Sparkles className="h-3 w-3 text-primary" />
                {generatingSeo ? tr("Generating...") : tr("Generate AI")}
              </Button>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-semibold text-muted-foreground">
                {tr("Meta Title")}
              </label>
              <Input
                type="text"
                value={metaTitle}
                onChange={(e) => setMetaTitle(e.target.value)}
                placeholder={tr("Title for Search Engines")}
                className="text-sm h-9"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-semibold text-muted-foreground">
                {tr("Meta Description")}
              </label>
              <textarea
                value={metaDescription}
                onChange={(e) => setMetaDescription(e.target.value)}
                placeholder={tr("Search engine description...")}
                className="w-full min-h-[80px] text-sm flex rounded-md border border-input bg-transparent px-3 py-2 shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-semibold text-muted-foreground">
                {tr("Canonical URL")}
              </label>
              <Input
                type="text"
                value={canonicalUrl}
                onChange={(e) => setCanonicalUrl(e.target.value)}
                placeholder="https://..."
                className="text-sm font-mono h-9"
              />
              <p className="text-[11px] text-muted-foreground">
                {tr("Leave blank to use the default canonical URL.")}
              </p>
            </div>
          </div>

          {/* Schedule */}
          {postId && canPublish && (
            <div className="space-y-4 border-t pt-6">
              <h3 className="text-sm font-bold flex items-center gap-2">
                <Calendar className="h-4 w-4 text-amber-500" /> {tr("Publish Date")}
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
                  {tr("Schedule")}
                </Button>
              </div>
            </div>
          )}

          {/* Multilingual Translation Management */}
          {postId && (
            <div className="space-y-4 border-t pt-6">
              <TranslationSidebarSection
                contentType="post"
                contentId={postId}
                onNavigate={onNavigate || (() => {})}
              />
            </div>
          )}

          {/* Revisions History */}
          {postId && revisions.length > 0 && (
            <div className="space-y-4 border-t pt-6">
              <h3 className="text-sm font-bold flex items-center gap-2">
                <History className="h-4 w-4 text-indigo-500" /> {tr("History")}
              </h3>
              <div className="space-y-2">
                {revisions.map((rev) => (
                  <div
                    key={rev.id}
                    className="flex flex-col gap-2 p-3 rounded-lg border bg-muted/20 text-xs"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold">
                        {tr("Version #")}{rev.revisionNumber}
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
                      <RotateCcw className="h-3 w-3" /> {tr("Restore Version")}
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
