import React, { useState, useEffect } from "react";

export interface ImageMetadataPopoverProps {
  alt?: string | undefined;
  caption?: string | undefined;
  href?: string | undefined;
  onUpdate: (data: { alt: string; caption: string; href?: string | undefined }) => void;
  onClose: () => void;
}

export const ImageMetadataPopover: React.FC<ImageMetadataPopoverProps> = ({
  alt = "",
  caption = "",
  href = "",
  onUpdate,
  onClose,
}) => {
  const [altText, setAltText] = useState(alt);
  const [captionText, setCaptionText] = useState(caption);
  const [linkHref, setLinkHref] = useState(href);

  useEffect(() => {
    setAltText(alt);
  }, [alt]);

  useEffect(() => {
    setCaptionText(caption);
  }, [caption]);

  useEffect(() => {
    setLinkHref(href);
  }, [href]);

  const handleBlur = () => {
    if (altText !== alt || captionText !== caption || linkHref !== href) {
      onUpdate({
        alt: altText,
        caption: captionText,
        href: linkHref.trim() || undefined,
      });
    }
  };

  const handleDone = () => {
    handleBlur();
    onClose();
  };

  return (
    <div className="space-y-3.5" data-testid="image-metadata-popover">
      <div>
        <label className="block text-xs font-medium text-foreground mb-1">
          Alt Text (accessibility & SEO)
        </label>
        <input
          type="text"
          value={altText}
          onChange={(e) => setAltText(e.target.value)}
          onBlur={handleBlur}
          placeholder="Describe this image for screen readers..."
          className="w-full text-xs px-3 py-2 rounded-lg bg-background border border-border/70 focus:outline-none focus:ring-1 focus:ring-primary text-foreground placeholder:text-muted-foreground/60"
          dir="auto"
          aria-label="Image alt text"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-foreground mb-1">
          Editorial Caption
        </label>
        <input
          type="text"
          value={captionText}
          onChange={(e) => setCaptionText(e.target.value)}
          onBlur={handleBlur}
          placeholder="Add an editorial caption or photo credit..."
          className="w-full text-xs px-3 py-2 rounded-lg bg-background border border-border/70 focus:outline-none focus:ring-1 focus:ring-primary text-foreground placeholder:text-muted-foreground/60"
          dir="auto"
          aria-label="Image editorial caption"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-foreground mb-1">
          Link URL (optional)
        </label>
        <input
          type="url"
          value={linkHref}
          onChange={(e) => setLinkHref(e.target.value)}
          onBlur={handleBlur}
          placeholder="https://... (link on click)"
          className="w-full text-xs px-3 py-2 rounded-lg bg-background border border-border/70 focus:outline-none focus:ring-1 focus:ring-primary text-foreground placeholder:text-muted-foreground/60"
          aria-label="Image destination link"
        />
      </div>

      <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-2 border-t border-border/40">
        <span>Changes save automatically on blur.</span>
        <button
          type="button"
          onClick={handleDone}
          className="h-6 px-2.5 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          Done
        </button>
      </div>
    </div>
  );
};
