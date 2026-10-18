import React, { useState } from "react";
import { type SocialLink, SocialPlatformSchema } from "@vibress/api-contracts";
import { Share2, Plus, Trash2, ArrowUp, ArrowDown } from "lucide-react";
import { useAdminLocale } from "../../../lib/admin-locale";
import { SettingsCard } from "../SettingsCard";
import { SettingsCardRow } from "../SettingsCardRow";
import { Input } from "../../ui/input";
import { Button } from "../../ui/button";

interface SocialLinksCardProps {
  links?: SocialLink[] | undefined;
  onChange: (links: SocialLink[]) => void;
  isHighlighted?: boolean | undefined;
}

export const SocialLinksCard: React.FC<SocialLinksCardProps> = ({
  links = [], onChange, isHighlighted,
}) => {
  const { tr } = useAdminLocale();
  const [expanded, setExpanded] = useState(false);
  const safeLinks = Array.isArray(links) ? links : [];

  const addLink = () => {
    if (safeLinks.length >= 20) return;
    const id = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `social-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    onChange([...safeLinks, { id, platform: "instagram", label: "Instagram", url: "" }]);
  };

  const update = (id: string, next: Partial<SocialLink>) => {
    onChange(safeLinks.map((item) => item.id === id ? { ...item, ...next } : item));
  };

  const move = (index: number, offset: number) => {
    const target = index + offset;
    if (target < 0 || target >= safeLinks.length) return;
    const items = [...safeLinks];
    [items[index], items[target]] = [items[target]!, items[index]!];
    onChange(items);
  };

  return (
    <SettingsCard id="site-social-links" isHighlighted={isHighlighted}>
      <SettingsCardRow
        icon={<Share2 className="h-4 w-4" />}
        title={tr("Social links")}
        description={tr("Connect your publication's profiles. Themes can display them anywhere.")}
        currentValue={<span>{safeLinks.length} {tr("links")}</span>}
        actionLabel={expanded ? tr("Close") : tr("Manage")}
        isExpanded={expanded}
        onAction={() => setExpanded(!expanded)}
      />
      {expanded && (
        <div className="space-y-4 border-t border-border/50 p-5 bg-muted/10">
          <p className="text-xs text-muted-foreground">
            {tr("Social links appear in built-in theme footers. Changes are saved with Site settings.")}
          </p>
          {safeLinks.map((link, index) => (
            <fieldset key={link.id} className="rounded-lg border border-border/60 bg-card p-3 space-y-3">
              <legend className="px-1 text-xs font-semibold">{link.label || tr("Social profile")}</legend>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="block text-xs font-medium space-y-1">
                  <span>{tr("Platform")}</span>
                  <select className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
                    value={link.platform}
                    onChange={(event) => {
                      const parsed = SocialPlatformSchema.safeParse(event.target.value);
                      if (parsed.success) update(link.id, { platform: parsed.data });
                    }}>
                    {SocialPlatformSchema.options.map((platform) => (
                      <option value={platform} key={platform}>{platform}</option>
                    ))}
                  </select>
                </label>
                <label className="block text-xs font-medium space-y-1">
                  <span>{tr("Label")}</span>
                  <Input value={link.label} maxLength={100} onChange={(event) => update(link.id, { label: event.target.value })} />
                </label>
              </div>
              <label className="block text-xs font-medium space-y-1">
                <span>{tr("Profile URL (HTTPS)")}</span>
                <Input type="url" value={link.url} maxLength={2048} placeholder="https://example.com/profile"
                  onChange={(event) => update(link.id, { url: event.target.value })} />
              </label>
              <div className="flex justify-end gap-2">
                <Button size="sm" type="button" variant="outline" disabled={index === 0}
                  aria-label={tr("Move link up")} onClick={() => move(index, -1)}><ArrowUp className="h-4 w-4" /></Button>
                <Button size="sm" type="button" variant="outline" disabled={index === safeLinks.length - 1}
                  aria-label={tr("Move link down")} onClick={() => move(index, 1)}><ArrowDown className="h-4 w-4" /></Button>
                <Button size="sm" type="button" variant="outline"
                  aria-label={tr("Remove social link")} onClick={() => onChange(safeLinks.filter((item) => item.id !== link.id))}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </fieldset>
          ))}
          <Button type="button" size="sm" variant="outline" disabled={safeLinks.length >= 20}
            onClick={addLink}><Plus className="h-4 w-4 me-2" />{tr("Add social link")}</Button>
          <p className="text-xs text-muted-foreground">{tr("A unique label and an HTTPS profile URL are required. Maximum 20 links.")}</p>
        </div>
      )}
    </SettingsCard>
  );
};
