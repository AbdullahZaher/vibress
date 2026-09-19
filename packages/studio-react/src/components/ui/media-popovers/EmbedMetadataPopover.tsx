import React, { useState, useEffect } from "react";

export interface EmbedMetadataPopoverProps {
  url?: string;
  caption?: string;
  onUpdate: (data: { url: string; caption: string }) => void;
  onClose: () => void;
}

export const EmbedMetadataPopover: React.FC<EmbedMetadataPopoverProps> = ({
  url = "",
  caption = "",
  onUpdate,
  onClose,
}) => {
  const [embedUrl, setEmbedUrl] = useState(url);
  const [captionText, setCaptionText] = useState(caption);

  useEffect(() => {
    setEmbedUrl(url);
  }, [url]);

  useEffect(() => {
    setCaptionText(caption);
  }, [caption]);

  const handleBlur = () => {
    if (embedUrl !== url || captionText !== caption) {
      onUpdate({
        url: embedUrl.trim(),
        caption: captionText,
      });
    }
  };

  const handleDone = () => {
    handleBlur();
    onClose();
  };

  return (
    <div className="space-y-3.5" data-testid="embed-metadata-popover">
      <div>
        <label className="block text-xs font-medium text-foreground mb-1">
          Embed URL
        </label>
        <input
          type="url"
          value={embedUrl}
          onChange={(e) => setEmbedUrl(e.target.value)}
          onBlur={handleBlur}
          placeholder="https://www.youtube.com/watch?v=..."
          className="w-full text-xs px-3 py-2 rounded-lg bg-background border border-border/70 focus:outline-none focus:ring-1 focus:ring-primary text-foreground placeholder:text-muted-foreground/60"
          aria-label="Embed URL"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-foreground mb-1">
          Caption (optional)
        </label>
        <input
          type="text"
          value={captionText}
          onChange={(e) => setCaptionText(e.target.value)}
          onBlur={handleBlur}
          placeholder="Add an editorial caption..."
          className="w-full text-xs px-3 py-2 rounded-lg bg-background border border-border/70 focus:outline-none focus:ring-1 focus:ring-primary text-foreground placeholder:text-muted-foreground/60"
          dir="auto"
          aria-label="Embed caption"
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
