import React, { useState } from "react";
import { SettingsCard } from "../SettingsCard";
import { SettingsCardRow } from "../SettingsCardRow";
import { Input } from "../../ui/input";
import { Bell, BellOff } from "lucide-react";
import { Badge } from "../../ui/badge";

interface AnnouncementBarCardProps {
  enabled?: boolean | undefined;
  text?: string | undefined;
  url?: string | undefined;
  onChange?:
    | ((
        key: "announcementEnabled" | "announcementText" | "announcementUrl",
        value: unknown,
      ) => void)
    | undefined;
  isHighlighted?: boolean | undefined;
}

export const AnnouncementBarCard: React.FC<AnnouncementBarCardProps> = ({
  enabled = false,
  text = "",
  url = "",
  onChange,
  isHighlighted,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <SettingsCard id="site-announcement" isHighlighted={isHighlighted}>
      <SettingsCardRow
        icon={<Bell className="h-4 w-4" />}
        title="Announcement bar"
        description="Highlight important news, product launches, or special announcements at the top of your site."
        currentValue={
          enabled ? (
            <Badge
              variant="default"
              className="text-[10px] gap-1 px-2 py-0.5 bg-primary text-primary-foreground"
            >
              <Bell className="h-3 w-3" /> Live Announcement
            </Badge>
          ) : (
            <Badge
              variant="outline"
              className="text-[10px] gap-1 px-2 py-0.5 text-muted-foreground"
            >
              <BellOff className="h-3 w-3" /> Disabled
            </Badge>
          )
        }
        actionLabel={isExpanded ? "Close" : "Configure"}
        isExpanded={isExpanded}
        onAction={() => setIsExpanded(!isExpanded)}
      />

      {isExpanded && (
        <div className="border-t border-border/50 p-5 bg-muted/10 space-y-4 animate-in slide-in-from-top-2 duration-150">
          <div className="flex items-start justify-between gap-4 p-3.5 rounded-lg border border-border/50 bg-card">
            <div>
              <p className="text-xs font-semibold text-foreground">
                Show announcement bar
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Display a top banner on all public pages.
              </p>
            </div>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) =>
                onChange?.("announcementEnabled", e.target.checked)
              }
              className="size-4 rounded border-border text-primary focus:ring-primary mt-1 cursor-pointer"
            />
          </div>

          {enabled && (
            <div className="space-y-3 pt-1 animate-in fade-in duration-150">
              <div className="space-y-1.5">
                <label
                  htmlFor="card-announce-text"
                  className="text-xs font-semibold text-foreground"
                >
                  Announcement text
                </label>
                <Input
                  id="card-announce-text"
                  value={text}
                  onChange={(e) =>
                    onChange?.("announcementText", e.target.value)
                  }
                  placeholder="e.g. 🎉 We just launched Vibress v1.0! Read our roadmap."
                />
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="card-announce-url"
                  className="text-xs font-semibold text-foreground"
                >
                  Target link URL (Optional)
                </label>
                <Input
                  id="card-announce-url"
                  value={url}
                  onChange={(e) =>
                    onChange?.("announcementUrl", e.target.value)
                  }
                  placeholder="e.g. /posts/announcement"
                  className="font-mono text-xs"
                />
              </div>
            </div>
          )}
        </div>
      )}
    </SettingsCard>
  );
};
