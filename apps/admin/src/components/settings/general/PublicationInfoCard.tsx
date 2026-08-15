import React, { useState } from "react";
import { SettingsCard } from "../SettingsCard";
import { SettingsCardRow } from "../SettingsCardRow";
import { Input } from "../../ui/input";
import { Globe } from "lucide-react";

interface PublicationInfoCardProps {
  title: string;
  tagline: string;
  description: string;
  onChange: (key: "title" | "tagline" | "description", value: string) => void;
  isHighlighted?: boolean | undefined;
}

export const PublicationInfoCard: React.FC<PublicationInfoCardProps> = ({
  title,
  tagline,
  description,
  onChange,
  isHighlighted,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <SettingsCard id="general-info" isHighlighted={isHighlighted}>
      <SettingsCardRow
        icon={<Globe className="h-4 w-4" />}
        title="Title & description"
        description="The details used to identify your publication around the web and in search results."
        currentValue={
          <div className="flex items-center gap-2 font-medium text-xs">
            <span className="font-semibold text-foreground">
              {title || "Vibress"}
            </span>
            {tagline && (
              <span className="text-muted-foreground hidden md:inline truncate max-w-[240px]">
                — {tagline}
              </span>
            )}
          </div>
        }
        actionLabel={isExpanded ? "Close" : "Edit"}
        isExpanded={isExpanded}
        onAction={() => setIsExpanded(!isExpanded)}
      />

      {isExpanded && (
        <div className="border-t border-border/40 p-5 bg-muted/15 space-y-4 animate-in slide-in-from-top-2 duration-150">
          <div className="space-y-1.5">
            <label
              htmlFor="card-site-title"
              className="text-xs font-semibold text-foreground"
            >
              Site title
            </label>
            <Input
              id="card-site-title"
              value={title}
              onChange={(e) => onChange("title", e.target.value)}
              placeholder="e.g. The Daily Drop"
              className="bg-card text-xs h-9"
              required
            />
            <p className="text-[11px] text-muted-foreground">
              The name of your publication or brand.
            </p>
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="card-site-tagline"
              className="text-xs font-semibold text-foreground"
            >
              Site tagline
            </label>
            <Input
              id="card-site-tagline"
              value={tagline}
              onChange={(e) => onChange("tagline", e.target.value)}
              placeholder="e.g. Thoughts, stories and ideas"
              className="bg-card text-xs h-9"
            />
            <p className="text-[11px] text-muted-foreground">
              A memorable short description of your site.
            </p>
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="card-site-desc"
              className="text-xs font-semibold text-foreground"
            >
              Site description
            </label>
            <textarea
              id="card-site-desc"
              value={description}
              onChange={(e) => onChange("description", e.target.value)}
              rows={3}
              className="w-full rounded-md border border-input bg-card px-3 py-2 text-xs ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              placeholder="Describe what your publication is about..."
            />
            <p className="text-[11px] text-muted-foreground">
              Used in themes and search engine metadata descriptions.
            </p>
          </div>
        </div>
      )}
    </SettingsCard>
  );
};
