import React from "react";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import { X, Sparkles } from "lucide-react";

interface PageSettingsSidebarProps {
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
}

export const PageSettingsSidebar: React.FC<PageSettingsSidebarProps> = ({
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
          <h2 className="font-semibold text-sm">Page Settings</h2>
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
                placeholder="page-url-slug"
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
        </div>
      </div>
    </>
  );
};
