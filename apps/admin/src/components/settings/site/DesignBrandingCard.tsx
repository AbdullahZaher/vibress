import React, { useState, useRef } from "react";
import { SettingsCard } from "../SettingsCard";
import { SettingsCardRow } from "../SettingsCardRow";
import { Input } from "../../ui/input";
import { Button } from "../../ui/button";
import {
  Palette,
  Image as ImageIcon,
  Check,
  Sparkles,
  RefreshCw,
} from "lucide-react";
import { uploadMediaApi } from "../../../lib/api/media";

interface DesignBrandingCardProps {
  accentColor?: string | undefined;
  iconUrl?: string | undefined;
  logoUrl?: string | undefined;
  coverUrl?: string | undefined;
  onChange?:
    | ((
        key: "accentColor" | "iconUrl" | "logoUrl" | "coverUrl",
        value: string,
      ) => void)
    | undefined;
  isHighlighted?: boolean | undefined;
}

const PRESET_ACCENTS = [
  "#6366f1", // Indigo / Vibress Primary
  "#3eb0ef", // Sky Blue
  "#10b981", // Emerald
  "#f59e0b", // Amber
  "#ec4899", // Pink
  "#8b5cf6", // Violet
  "#18191d", // Solid Dark
];

export const DesignBrandingCard: React.FC<DesignBrandingCardProps> = ({
  accentColor = "#6366f1",
  iconUrl = "",
  logoUrl = "",
  coverUrl: _coverUrl,
  onChange,
  isHighlighted,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [uploadingIcon, setUploadingIcon] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const iconInputRef = useRef<HTMLInputElement>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const handleColorSelect = (color: string) => {
    onChange?.("accentColor", color);
  };

  const handleIconUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingIcon(true);
    setUploadError(null);
    try {
      const res = await uploadMediaApi(file);
      onChange?.("iconUrl", res.media.url);
    } catch (err: unknown) {
      setUploadError(err instanceof Error ? err.message : "Icon upload failed");
    } finally {
      setUploadingIcon(false);
    }
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingLogo(true);
    setUploadError(null);
    try {
      const res = await uploadMediaApi(file);
      onChange?.("logoUrl", res.media.url);
    } catch (err: unknown) {
      setUploadError(err instanceof Error ? err.message : "Logo upload failed");
    } finally {
      setUploadingLogo(false);
    }
  };

  return (
    <SettingsCard id="site-branding" isHighlighted={isHighlighted}>
      <SettingsCardRow
        icon={<Palette className="h-4 w-4" />}
        title="Design & branding"
        description="Customize your publication accent colors, site icons, and cover imagery."
        currentValue={
          <div className="flex items-center gap-2">
            <div
              className="size-4 rounded-full border border-border shadow-xs"
              style={{ backgroundColor: accentColor }}
            />
            <span className="font-mono text-xs text-foreground uppercase">
              {accentColor}
            </span>
          </div>
        }
        actionLabel={isExpanded ? "Close" : "Customize"}
        isExpanded={isExpanded}
        onAction={() => setIsExpanded(!isExpanded)}
      />

      {isExpanded && (
        <div className="border-t border-border/40 p-5 bg-muted/15 space-y-5 animate-in slide-in-from-top-2 duration-150">
          {/* Visual Theme Preview Mockup Banner */}
          <div className="rounded-xl border border-border/70 overflow-hidden bg-card p-4 flex flex-col sm:flex-row items-center justify-between gap-4 shadow-xs">
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-xs font-bold text-foreground">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                Live Brand Style & Palette
              </div>
              <p className="text-[11px] text-muted-foreground">
                Accent colors are applied throughout themes, buttons, links, and
                newsletters.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5 bg-muted/40 px-3 py-1.5 rounded-lg border border-border/50">
                <div
                  className="size-5 rounded-md shadow-xs"
                  style={{ backgroundColor: accentColor }}
                />
                <span className="font-mono text-xs font-bold text-foreground uppercase">
                  {accentColor}
                </span>
              </div>
            </div>
          </div>

          {/* Accent Color Picker */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-foreground">
              Publication accent color
            </label>
            <div className="flex flex-wrap items-center gap-3">
              {/* Color Swatch Circles */}
              <div className="flex items-center gap-2">
                {PRESET_ACCENTS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => handleColorSelect(c)}
                    className="size-7 rounded-full flex items-center justify-center transition-transform hover:scale-110 shadow-xs cursor-pointer relative"
                    style={{ backgroundColor: c }}
                    title={c}
                  >
                    {accentColor.toLowerCase() === c.toLowerCase() && (
                      <Check className="h-3.5 w-3.5 text-white drop-shadow-md" />
                    )}
                  </button>
                ))}
              </div>

              {/* Hex Input with Indicator */}
              <div className="flex items-center gap-2">
                <Input
                  value={accentColor}
                  onChange={(e) => handleColorSelect(e.target.value)}
                  placeholder="#6366f1"
                  className="w-28 font-mono text-xs h-8 uppercase bg-card"
                />
              </div>
            </div>
          </div>

          {uploadError && (
            <p className="text-xs text-destructive font-medium">
              {uploadError}
            </p>
          )}

          {/* Site Icon & Logo Upload Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-border/40">
            <div className="p-4 rounded-xl border border-border/60 bg-card space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-foreground">
                  Publication Icon
                </span>
                <span className="text-[10px] text-muted-foreground">
                  Square PNG (min 60x60)
                </span>
              </div>
              <div className="flex items-center gap-3">
                {iconUrl ? (
                  <img
                    src={iconUrl}
                    alt="Site Icon"
                    className="size-11 rounded-xl object-cover shadow-xs border border-border/50"
                  />
                ) : (
                  <div
                    className="size-11 rounded-xl flex items-center justify-center font-bold text-sm text-white shadow-xs"
                    style={{ backgroundColor: accentColor }}
                  >
                    V
                  </div>
                )}
                <input
                  ref={iconInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/svg+xml,image/webp"
                  onChange={handleIconUpload}
                  className="hidden"
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={uploadingIcon}
                  onClick={() => iconInputRef.current?.click()}
                  className="text-xs h-8 cursor-pointer bg-card hover:bg-muted"
                >
                  {uploadingIcon ? (
                    <RefreshCw className="h-3.5 w-3.5 mr-1 animate-spin" />
                  ) : (
                    <ImageIcon className="h-3.5 w-3.5 mr-1" />
                  )}
                  {iconUrl ? "Change icon" : "Upload icon"}
                </Button>
              </div>
            </div>

            <div className="p-4 rounded-xl border border-border/60 bg-card space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-foreground">
                  Publication Logo
                </span>
                <span className="text-[10px] text-muted-foreground">
                  Transparent SVG / PNG
                </span>
              </div>
              <div className="flex items-center gap-3">
                {logoUrl ? (
                  <img
                    src={logoUrl}
                    alt="Logo"
                    className="h-11 max-w-[120px] object-contain p-1 rounded-lg bg-muted/40 border border-border/60"
                  />
                ) : (
                  <div className="h-11 px-4 rounded-lg bg-muted/40 border border-border/60 flex items-center justify-center text-xs font-semibold text-muted-foreground">
                    Vibress.
                  </div>
                )}
                <input
                  ref={logoInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/svg+xml,image/webp"
                  onChange={handleLogoUpload}
                  className="hidden"
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={uploadingLogo}
                  onClick={() => logoInputRef.current?.click()}
                  className="text-xs h-8 cursor-pointer bg-card hover:bg-muted"
                >
                  {uploadingLogo ? (
                    <RefreshCw className="h-3.5 w-3.5 mr-1 animate-spin" />
                  ) : (
                    <ImageIcon className="h-3.5 w-3.5 mr-1" />
                  )}
                  {logoUrl ? "Change logo" : "Upload logo"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </SettingsCard>
  );
};
