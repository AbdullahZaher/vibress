import React, { useState, useEffect } from "react";

export interface GalleryMetadataPopoverProps {
  caption?: string;
  onUpdate: (data: { caption: string }) => void;
  onClose: () => void;
}

export const GalleryMetadataPopover: React.FC<GalleryMetadataPopoverProps> = ({
  caption = "",
  onUpdate,
  onClose,
}) => {
  const [captionText, setCaptionText] = useState(caption);

  useEffect(() => {
    setCaptionText(caption);
  }, [caption]);

  const handleBlur = () => {
    if (captionText !== caption) {
      onUpdate({ caption: captionText });
    }
  };

  const handleDone = () => {
    handleBlur();
    onClose();
  };

  return (
    <div className="space-y-3.5" data-testid="gallery-metadata-popover">
      <div>
        <label className="block text-xs font-medium text-foreground mb-1">
          Gallery Caption
        </label>
        <input
          type="text"
          value={captionText}
          onChange={(e) => setCaptionText(e.target.value)}
          onBlur={handleBlur}
          placeholder="Add an editorial caption for this gallery..."
          className="w-full text-xs px-3 py-2 rounded-lg bg-background border border-border/70 focus:outline-none focus:ring-1 focus:ring-primary text-foreground placeholder:text-muted-foreground/60"
          dir="auto"
          aria-label="Gallery caption"
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
