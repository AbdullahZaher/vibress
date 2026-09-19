import React, { useState, useEffect } from "react";

export interface VideoMetadataPopoverProps {
  caption?: string | undefined;
  poster?: string | undefined;
  loop?: boolean | undefined;
  autoplay?: boolean | undefined;
  onUpdate: (data: {
    caption: string;
    poster?: string | undefined;
    loop?: boolean | undefined;
    autoplay?: boolean | undefined;
  }) => void;
  onClose: () => void;
}

export const VideoMetadataPopover: React.FC<VideoMetadataPopoverProps> = ({
  caption = "",
  poster = "",
  loop = false,
  autoplay = false,
  onUpdate,
  onClose,
}) => {
  const [captionText, setCaptionText] = useState(caption);
  const [posterUrl, setPosterUrl] = useState(poster);
  const [isLoop, setIsLoop] = useState(loop);
  const [isAutoplay, setIsAutoplay] = useState(autoplay);

  useEffect(() => {
    setCaptionText(caption);
  }, [caption]);

  useEffect(() => {
    setPosterUrl(poster);
  }, [poster]);

  useEffect(() => {
    setIsLoop(loop);
  }, [loop]);

  useEffect(() => {
    setIsAutoplay(autoplay);
  }, [autoplay]);

  const handleBlur = () => {
    if (
      captionText !== caption ||
      posterUrl !== poster ||
      isLoop !== loop ||
      isAutoplay !== autoplay
    ) {
      onUpdate({
        caption: captionText,
        poster: posterUrl.trim() || undefined,
        loop: isLoop,
        autoplay: isAutoplay,
      });
    }
  };

  const handleDone = () => {
    handleBlur();
    onClose();
  };

  return (
    <div className="space-y-3.5" data-testid="video-metadata-popover">
      <div>
        <label className="block text-xs font-medium text-foreground mb-1">
          Editorial Caption
        </label>
        <input
          type="text"
          value={captionText}
          onChange={(e) => setCaptionText(e.target.value)}
          onBlur={handleBlur}
          placeholder="Add an editorial caption..."
          className="w-full text-xs px-3 py-2 rounded-lg bg-background border border-border/70 focus:outline-none focus:ring-1 focus:ring-primary text-foreground placeholder:text-muted-foreground/60"
          dir="auto"
          aria-label="Video editorial caption"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-foreground mb-1">
          Cover / Poster URL (optional)
        </label>
        <input
          type="url"
          value={posterUrl}
          onChange={(e) => setPosterUrl(e.target.value)}
          onBlur={handleBlur}
          placeholder="https://... (thumbnail preview)"
          className="w-full text-xs px-3 py-2 rounded-lg bg-background border border-border/70 focus:outline-none focus:ring-1 focus:ring-primary text-foreground placeholder:text-muted-foreground/60"
          aria-label="Video poster URL"
        />
      </div>

      <div className="flex items-center gap-6 pt-1">
        <label className="flex items-center gap-2 text-xs font-medium text-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={isLoop}
            onChange={(e) => {
              setIsLoop(e.target.checked);
              onUpdate({
                caption: captionText,
                poster: posterUrl.trim() || undefined,
                loop: e.target.checked,
                autoplay: isAutoplay,
              });
            }}
            className="rounded border-border/70 text-primary focus:ring-primary"
          />
          <span>Loop video</span>
        </label>

        <label className="flex items-center gap-2 text-xs font-medium text-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={isAutoplay}
            onChange={(e) => {
              setIsAutoplay(e.target.checked);
              onUpdate({
                caption: captionText,
                poster: posterUrl.trim() || undefined,
                loop: isLoop,
                autoplay: e.target.checked,
              });
            }}
            className="rounded border-border/70 text-primary focus:ring-primary"
          />
          <span>Autoplay</span>
        </label>
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
