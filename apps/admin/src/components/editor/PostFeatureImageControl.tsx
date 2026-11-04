import React, { useState } from "react";
import {
  ImageIcon,
  Sparkles,
  ExternalLink,
} from "lucide-react";
import { ApiMediaAsset } from "../../lib/api";
import { useAdminLocale } from "../../lib/admin-locale";
import {
  StudioMediaFloatingToolbar,
  ImageMetadataPopover,
} from "@vibress/studio-react";

export interface PostFeatureImageControlProps {
  featureImage: ApiMediaAsset | null;
  featureImageAlt: string;
  featureImageCaption: string;
  onOpenMediaPicker: () => void;
  onOpenUnsplashModal: () => void;
  onRemoveFeatureImage: () => void;
  onUpdateAltAndCaption: (alt: string, caption: string) => void;
  disabled?: boolean;
}

export const PostFeatureImageControl: React.FC<PostFeatureImageControlProps> = ({
  featureImage,
  featureImageAlt,
  featureImageCaption,
  onOpenMediaPicker,
  onOpenUnsplashModal,
  onRemoveFeatureImage,
  onUpdateAltAndCaption,
  disabled = false,
}) => {
  const { tr } = useAdminLocale();
  const [altText, setAltText] = useState(featureImageAlt);
  const [caption, setCaption] = useState(featureImageCaption);

  // Sync internal state if prop updates externally
  React.useEffect(() => {
    setAltText(featureImageAlt);
  }, [featureImageAlt]);

  React.useEffect(() => {
    setCaption(featureImageCaption);
  }, [featureImageCaption]);

  const unsplashMeta = (featureImage?.metadata as any)?.unsplash;

  // 1. EMPTY STATE — Minimalist Ghost-style clean trigger
  if (!featureImage) {
    return (
      <div className="mb-4 flex items-center gap-1.5">
        <button
          type="button"
          disabled={disabled}
          onClick={onOpenMediaPicker}
          className="group inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground/75 hover:text-foreground transition-colors py-1 focus:outline-none"
          aria-label={tr("Add feature image")}
        >
          <span className="text-sm font-normal text-muted-foreground/60 group-hover:text-foreground">+</span>
          <span>{tr("Add feature image")}</span>
        </button>

        <button
          type="button"
          disabled={disabled}
          onClick={onOpenMediaPicker}
          className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground/60 hover:text-foreground hover:bg-muted/40 transition-colors focus:outline-none ms-0.5"
          title={tr("Upload feature image")}
          aria-label={tr("Upload feature image")}
        >
          <ImageIcon className="w-3.5 h-3.5" />
        </button>

        <button
          type="button"
          disabled={disabled}
          onClick={onOpenUnsplashModal}
          className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground/60 hover:text-amber-500 hover:bg-muted/40 transition-colors focus:outline-none"
          title="Unsplash"
          aria-label="Add feature image from Unsplash"
        >
          <Sparkles className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  // 2. POPULATED STATE
  return (
    <div className="mb-8 group relative rounded-2xl overflow-hidden border border-border/80 bg-muted/10 shadow-sm transition-all">
      {/* Feature Image Responsive Preview */}
      <div className="relative w-full max-h-[440px] overflow-hidden bg-muted/20 flex items-center justify-center">
        <img
          src={featureImage.url ?? undefined}
          alt={altText || featureImage.displayName || "Feature image"}
          className="w-full h-auto max-h-[440px] object-cover transition-transform duration-300"
        />

        {/* Floating Action Bar (reusing StudioMediaFloatingToolbar) */}
        <StudioMediaFloatingToolbar
          onChange={onOpenMediaPicker}
          changeLabel={tr("Change")}
          changeTitle={tr("Change")}
          onUnsplash={onOpenUnsplashModal}
          metadataLabel={tr("Alt / Caption")}
          metadataTitle={tr("Alt / Caption")}
          metadataContent={
            <ImageMetadataPopover
              alt={altText}
              caption={caption}
              onUpdate={({ alt: newAlt, caption: newCaption }) => {
                setAltText(newAlt);
                setCaption(newCaption);
                onUpdateAltAndCaption(newAlt, newCaption);
              }}
              onClose={() => {}}
            />
          }
          onDelete={onRemoveFeatureImage}
          deleteTitle={tr("Delete")}
          disabled={disabled}
        />
      </div>

      {/* Unsplash Attribution / Caption Footer */}
      {(caption || unsplashMeta) && (
        <div className="px-4 py-2 border-t border-border/40 bg-card/50 text-xs text-muted-foreground flex items-center justify-between">
          <div className="truncate">
            {caption ? (
              <span>{caption}</span>
            ) : unsplashMeta ? (
              <span className="flex items-center gap-1.5">
                <span>Photo by</span>
                <a
                  href={unsplashMeta.photographerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-foreground hover:underline inline-flex items-center gap-0.5"
                >
                  {unsplashMeta.photographerName}
                  <ExternalLink className="w-2.5 h-2.5 opacity-60" />
                </a>
                <span>on</span>
                <a
                  href={unsplashMeta.photoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-foreground hover:underline inline-flex items-center gap-0.5"
                >
                  Unsplash
                  <ExternalLink className="w-2.5 h-2.5 opacity-60" />
                </a>
              </span>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
};
