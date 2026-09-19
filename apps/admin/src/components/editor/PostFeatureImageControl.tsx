import React, { useState } from "react";
import {
  ImageIcon,
  Sparkles,
  ExternalLink,
} from "lucide-react";
import { ApiMediaAsset } from "../../lib/api";
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

  // 1. EMPTY STATE
  if (!featureImage) {
    return (
      <div className="mb-6 flex items-center gap-3">
        <button
          type="button"
          disabled={disabled}
          onClick={onOpenMediaPicker}
          className="group inline-flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-lg border border-dashed border-border/70 hover:border-border hover:bg-muted/30 transition-all focus:outline-none focus:ring-2 focus:ring-primary/30"
          aria-label="Add feature image from media library"
        >
          <ImageIcon className="w-3.5 h-3.5 text-muted-foreground/70 group-hover:text-primary transition-colors" />
          <span>Add feature image</span>
        </button>

        <button
          type="button"
          disabled={disabled}
          onClick={onOpenUnsplashModal}
          className="group inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-lg border border-dashed border-border/70 hover:border-border hover:bg-muted/30 transition-all focus:outline-none focus:ring-2 focus:ring-primary/30"
          aria-label="Add feature image from Unsplash"
        >
          <Sparkles className="w-3.5 h-3.5 text-amber-500/80 group-hover:text-amber-500 transition-colors" />
          <span>Unsplash</span>
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
          src={featureImage.url}
          alt={altText || featureImage.displayName || "Feature image"}
          className="w-full h-auto max-h-[440px] object-cover transition-transform duration-300"
        />

        {/* Floating Action Bar (reusing StudioMediaFloatingToolbar) */}
        <StudioMediaFloatingToolbar
          onChange={onOpenMediaPicker}
          changeLabel="Change"
          changeTitle="Change image from library"
          onUnsplash={onOpenUnsplashModal}
          metadataLabel="Alt / Caption"
          metadataTitle="Edit alt text and caption"
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
          deleteTitle="Remove feature image"
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
