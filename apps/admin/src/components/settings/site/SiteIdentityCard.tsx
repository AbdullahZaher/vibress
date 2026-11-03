import React, { useRef, useState } from "react";
import { Image as ImageIcon, RefreshCw } from "lucide-react";
import { SettingsCard } from "../SettingsCard";
import { SettingsCardRow } from "../SettingsCardRow";
import { Button } from "../../ui/button";
import { useAdminLocale } from "../../../lib/admin-locale";
import { uploadMediaApi } from "../../../lib/api/media";

interface SiteIdentityCardProps {
  iconUrl?: string | undefined;
  logoUrl?: string | undefined;
  onChange?: ((key: "iconUrl" | "logoUrl", value: string) => void) | undefined;
  isHighlighted?: boolean | undefined;
}

/** Publication-owned assets. Theme colors are edited only through Theme Studio. */
export const SiteIdentityCard: React.FC<SiteIdentityCardProps> = ({
  iconUrl = "",
  logoUrl = "",
  onChange,
  isHighlighted,
}) => {
  const { tr } = useAdminLocale();
  const [isExpanded, setIsExpanded] = useState(false);
  const panelId = React.useId();
  const [uploadingIcon, setUploadingIcon] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const iconInputRef = useRef<HTMLInputElement>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const handleIconUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploadingIcon(true);
    setUploadError(null);
    try {
      const response = await uploadMediaApi(file);
      if (response.media.url) onChange?.("iconUrl", response.media.url);
    } catch (error: unknown) {
      setUploadError(error instanceof Error ? error.message : tr("Icon upload failed"));
    } finally {
      setUploadingIcon(false);
      event.target.value = "";
    }
  };

  const handleLogoUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploadingLogo(true);
    setUploadError(null);
    try {
      const response = await uploadMediaApi(file);
      if (response.media.url) onChange?.("logoUrl", response.media.url);
    } catch (error: unknown) {
      setUploadError(error instanceof Error ? error.message : tr("Logo upload failed"));
    } finally {
      setUploadingLogo(false);
      event.target.value = "";
    }
  };

  return (
    <SettingsCard id="site-branding" isHighlighted={isHighlighted}>
      <SettingsCardRow
        icon={<ImageIcon className="h-4 w-4" />}
        title="Site Identity"
        description="Manage your publication logo and favicon."
        panelId={panelId}
        isExpanded={isExpanded}
        onAction={() => setIsExpanded((value) => !value)}
      />
      {!isExpanded && <div id={panelId} hidden />}
      {isExpanded && (
        <div id={panelId} className="space-y-4 border-t border-border/40 bg-muted/15 p-4 sm:p-5">
          {uploadError && (
            <p role="alert" className="text-xs font-medium text-destructive">{uploadError}</p>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-3 rounded-xl border border-border/60 bg-card p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold text-foreground">{tr("Publication Icon")}</span>
                <span className="text-xs text-muted-foreground">{tr("Square PNG (min 60x60)")}</span>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                {iconUrl ? (
                  <img src={iconUrl} alt={tr("Publication Icon")} className="size-11 rounded-xl border border-border/50 object-cover shadow-xs" />
                ) : (
                  <div aria-hidden="true" className="flex size-11 items-center justify-center rounded-xl border border-border/60 bg-muted font-bold text-foreground">V</div>
                )}
                <input
                  ref={iconInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/svg+xml,image/webp"
                  onChange={handleIconUpload}
                  aria-label={tr("Publication Icon")}
                  className="hidden"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={uploadingIcon}
                  onClick={() => iconInputRef.current?.click()}
                  className="min-h-11 bg-card text-sm hover:bg-muted"
                >
                  {uploadingIcon ? <RefreshCw className="me-1 h-3.5 w-3.5 animate-spin" /> : <ImageIcon className="me-1 h-3.5 w-3.5" />}
                  {iconUrl ? tr("Change icon") : tr("Upload icon")}
                </Button>
              </div>
            </div>
            <div className="space-y-3 rounded-xl border border-border/60 bg-card p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold text-foreground">{tr("Publication Logo")}</span>
                <span className="text-xs text-muted-foreground">{tr("Transparent SVG / PNG")}</span>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                {logoUrl ? (
                  <img src={logoUrl} alt={tr("Publication Logo")} className="h-11 max-w-[120px] rounded-lg border border-border/60 bg-muted/40 p-1 object-contain" />
                ) : (
                  <div aria-hidden="true" className="flex h-11 items-center justify-center rounded-lg border border-border/60 bg-muted/40 px-4 text-xs font-semibold text-muted-foreground">Vibress.</div>
                )}
                <input
                  ref={logoInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/svg+xml,image/webp"
                  onChange={handleLogoUpload}
                  aria-label={tr("Publication Logo")}
                  className="hidden"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={uploadingLogo}
                  onClick={() => logoInputRef.current?.click()}
                  className="min-h-11 bg-card text-sm hover:bg-muted"
                >
                  {uploadingLogo ? <RefreshCw className="me-1 h-3.5 w-3.5 animate-spin" /> : <ImageIcon className="me-1 h-3.5 w-3.5" />}
                  {logoUrl ? tr("Change logo") : tr("Upload logo")}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </SettingsCard>
  );
};
