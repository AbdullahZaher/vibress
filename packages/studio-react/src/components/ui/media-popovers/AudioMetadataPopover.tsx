import React, { useState, useEffect } from "react";

export interface AudioMetadataPopoverProps {
  title?: string;
  caption?: string;
  onUpdate: (data: { title: string; caption: string }) => void;
  onClose: () => void;
}

export const AudioMetadataPopover: React.FC<AudioMetadataPopoverProps> = ({
  title = "",
  caption = "",
  onUpdate,
  onClose,
}) => {
  const [audioTitle, setAudioTitle] = useState(title);
  const [captionText, setCaptionText] = useState(caption);

  useEffect(() => {
    setAudioTitle(title);
  }, [title]);

  useEffect(() => {
    setCaptionText(caption);
  }, [caption]);

  const handleBlur = () => {
    if (audioTitle !== title || captionText !== caption) {
      onUpdate({
        title: audioTitle,
        caption: captionText,
      });
    }
  };

  const handleDone = () => {
    handleBlur();
    onClose();
  };

  return (
    <div className="space-y-3.5" data-testid="audio-metadata-popover">
      <div>
        <label className="block text-xs font-medium text-foreground mb-1">
          Audio / Track Title
        </label>
        <input
          type="text"
          value={audioTitle}
          onChange={(e) => setAudioTitle(e.target.value)}
          onBlur={handleBlur}
          placeholder="Track or episode title..."
          className="w-full text-xs px-3 py-2 rounded-lg bg-background border border-border/70 focus:outline-none focus:ring-1 focus:ring-primary text-foreground placeholder:text-muted-foreground/60"
          dir="auto"
          aria-label="Audio track title"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-foreground mb-1">
          Editorial Caption (optional)
        </label>
        <input
          type="text"
          value={captionText}
          onChange={(e) => setCaptionText(e.target.value)}
          onBlur={handleBlur}
          placeholder="Add description or notes..."
          className="w-full text-xs px-3 py-2 rounded-lg bg-background border border-border/70 focus:outline-none focus:ring-1 focus:ring-primary text-foreground placeholder:text-muted-foreground/60"
          dir="auto"
          aria-label="Audio description"
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
