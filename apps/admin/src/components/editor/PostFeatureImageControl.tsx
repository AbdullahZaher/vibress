import React, { useState } from "react";
import {
  ImageIcon,
  Sparkles,
  Trash2,
  RefreshCw,
  Info,
  ChevronDown,
  ChevronUp,
  ExternalLink,
} from "lucide-react";
import { Button } from "../ui/button";
import { ApiMediaAsset } from "../../lib/api";

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
  const [showMetadataPanel, setShowMetadataPanel] = useState(false);
  const [altText, setAltText] = useState(featureImageAlt);
  const [caption, setCaption] = useState(featureImageCaption);

  // Sync internal state if prop updates externally
  React.useEffect(() => {
    setAltText(featureImageAlt);
  }, [featureImageAlt]);

  React.useEffect(() => {
    setCaption(featureImageCaption);
  }, [featureImageCaption]);

  const handleBlurMetadata = () => {
    if (altText !== featureImageAlt || caption !== featureImageCaption) {
      onUpdateAltAndCaption(altText, caption);
    }
  };

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

        {/* Floating Action Bar (visible on hover or focus) */}
        <div className="absolute top-3 right-3 flex items-center gap-1.5 p-1.5 rounded-xl bg-background/85 dark:bg-card/90 backdrop-blur-md border border-border/80 shadow-lg opacity-90 sm:opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-all">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={onOpenMediaPicker}
            className="h-7 px-2.5 text-xs font-medium gap-1.5 hover:bg-muted"
            title="Change image from library"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Change</span>
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={onOpenUnsplashModal}
            className="h-7 px-2.5 text-xs font-medium gap-1.5 hover:bg-muted text-amber-600 dark:text-amber-400"
            title="Replace from Unsplash"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Unsplash</span>
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setShowMetadataPanel((prev) => !prev)}
            className={`h-7 px-2 text-xs font-medium gap-1 hover:bg-muted ${
              showMetadataPanel ? "bg-muted text-foreground" : ""
            }`}
            title="Edit alt text and caption"
          >
            <Info className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Alt / Caption</span>
            {showMetadataPanel ? (
              <ChevronUp className="w-3 h-3" />
            ) : (
              <ChevronDown className="w-3 h-3" />
            )}
          </Button>

          <div className="w-px h-4 bg-border/60 mx-0.5" />

          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={onRemoveFeatureImage}
            className="h-7 px-2 text-xs font-medium text-destructive hover:bg-destructive/10 hover:text-destructive"
            title="Remove feature image"
            aria-label="Remove feature image"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {/* Unsplash Attribution / Caption Footer */}
      {(caption || unsplashMeta) && !showMetadataPanel && (
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

      {/* Collapsible Metadata (Alt text & Caption) Editor Panel */}
      {showMetadataPanel && (
        <div className="p-4 border-t border-border/60 bg-muted/20 animate-in slide-in-from-top-2 duration-150">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-3">
            <div>
              <label className="block text-xs font-medium text-foreground mb-1">
                Alt Text (accessibility & SEO)
              </label>
              <input
                type="text"
                value={altText}
                onChange={(e) => setAltText(e.target.value)}
                onBlur={handleBlurMetadata}
                placeholder="Describe this image for screen readers..."
                className="w-full text-xs px-3 py-2 rounded-lg bg-background border border-border/70 focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-foreground mb-1">
                Editorial Caption
              </label>
              <input
                type="text"
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                onBlur={handleBlurMetadata}
                placeholder="Add an editorial caption or photo credit..."
                className="w-full text-xs px-3 py-2 rounded-lg bg-background border border-border/70 focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>

          <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-1 border-t border-border/30">
            <span>Changes save automatically on blur.</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                handleBlurMetadata();
                setShowMetadataPanel(false);
              }}
              className="h-6 text-xs px-2"
            >
              Done
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
