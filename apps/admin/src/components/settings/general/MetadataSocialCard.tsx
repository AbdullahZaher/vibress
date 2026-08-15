import React, { useState } from "react";
import { SettingsCard } from "../SettingsCard";
import { SettingsCardRow } from "../SettingsCardRow";
import { Share2, Search, Globe } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "../../ui/tabs";

interface MetadataSocialCardProps {
  title: string;
  description: string;
  isHighlighted?: boolean | undefined;
}

export const MetadataSocialCard: React.FC<MetadataSocialCardProps> = ({
  title,
  description,
  isHighlighted,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [activePreview, setActivePreview] = useState("google");

  const siteTitle = title || "Vibress Publication";
  const siteDesc =
    description ||
    "The publication description that will appear on Google search results, X / Twitter, and Facebook.";

  return (
    <SettingsCard id="general-social" isHighlighted={isHighlighted}>
      <SettingsCardRow
        icon={<Share2 className="h-4 w-4" />}
        title="Search engine & social cards"
        description="Preview how your publication appears in Google search engine results and social media embeds."
        currentValue={
          <span className="text-xs text-muted-foreground font-medium">
            SERP & Social Previews
          </span>
        }
        actionLabel={isExpanded ? "Close" : "Preview"}
        isExpanded={isExpanded}
        onAction={() => setIsExpanded(!isExpanded)}
      />

      {isExpanded && (
        <div className="border-t border-border/40 p-5 bg-muted/15 space-y-4 animate-in slide-in-from-top-2 duration-150">
          <div className="flex items-center justify-between">
            <h5 className="text-xs font-semibold text-foreground">
              Live Search & Social Previews
            </h5>
            <Tabs
              value={activePreview}
              onValueChange={setActivePreview}
              className="w-auto"
            >
              <TabsList className="bg-card border border-border/60 p-0.5 h-8">
                <TabsTrigger
                  value="google"
                  className="text-[11px] px-3 py-1 gap-1.5 cursor-pointer"
                >
                  <Search className="h-3 w-3" /> Google Search
                </TabsTrigger>
                <TabsTrigger
                  value="twitter"
                  className="text-[11px] px-3 py-1 gap-1.5 cursor-pointer"
                >
                  X / Twitter
                </TabsTrigger>
                <TabsTrigger
                  value="facebook"
                  className="text-[11px] px-3 py-1 gap-1.5 cursor-pointer"
                >
                  Facebook
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {/* Google SERP Preview Mockup */}
          {activePreview === "google" && (
            <div className="p-5 rounded-xl border border-border/80 bg-card font-sans space-y-2 max-w-xl shadow-xs">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <div className="size-4 rounded-full bg-primary/20 flex items-center justify-center text-primary text-[10px] font-bold">
                  <Globe className="h-2.5 w-2.5" />
                </div>
                <div className="flex items-center gap-1 text-[11px]">
                  <span className="font-medium text-foreground">
                    vibress.org
                  </span>
                  <span>›</span>
                  <span>home</span>
                </div>
              </div>
              <h4 className="text-sm font-semibold text-blue-500 dark:text-blue-400 hover:underline cursor-pointer">
                {siteTitle} - Official Publication
              </h4>
              <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                {siteDesc}
              </p>
            </div>
          )}

          {/* Twitter / X Card Preview Mockup */}
          {activePreview === "twitter" && (
            <div className="rounded-2xl border border-border/80 overflow-hidden bg-card max-w-md shadow-xs">
              <div className="h-36 bg-gradient-to-br from-neutral-900 via-neutral-800 to-indigo-950 flex items-center justify-center p-4">
                <span className="text-sm font-bold text-neutral-200">
                  {siteTitle}
                </span>
              </div>
              <div className="p-3.5 space-y-1 bg-background/50 border-t border-border/50">
                <p className="text-[10px] text-muted-foreground uppercase font-mono tracking-wider">
                  vibress.org
                </p>
                <h4 className="text-xs font-bold text-foreground line-clamp-1">
                  {siteTitle}
                </h4>
                <p className="text-[11px] text-muted-foreground line-clamp-2">
                  {siteDesc}
                </p>
              </div>
            </div>
          )}

          {/* Facebook / OpenGraph Preview Mockup */}
          {activePreview === "facebook" && (
            <div className="rounded-xl border border-border/80 overflow-hidden bg-card max-w-md shadow-xs">
              <div className="h-36 bg-gradient-to-tr from-slate-900 to-neutral-800 flex items-center justify-center p-4">
                <span className="text-sm font-bold text-neutral-200">
                  {siteTitle}
                </span>
              </div>
              <div className="p-3.5 space-y-1 bg-background/50 border-t border-border/50">
                <p className="text-[10px] text-muted-foreground uppercase font-semibold">
                  VIBRESS.ORG
                </p>
                <h4 className="text-xs font-bold text-foreground line-clamp-1">
                  {siteTitle}
                </h4>
                <p className="text-[11px] text-muted-foreground line-clamp-2">
                  {siteDesc}
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </SettingsCard>
  );
};
