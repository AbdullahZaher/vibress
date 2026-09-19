import React, { useState, useEffect } from "react";

export interface FileMetadataPopoverProps {
  fileName?: string;
  caption?: string;
  onUpdate: (data: { fileName: string; caption: string }) => void;
  onClose: () => void;
}

export const FileMetadataPopover: React.FC<FileMetadataPopoverProps> = ({
  fileName = "",
  caption = "",
  onUpdate,
  onClose,
}) => {
  const [name, setName] = useState(fileName);
  const [captionText, setCaptionText] = useState(caption);

  useEffect(() => {
    setName(fileName);
  }, [fileName]);

  useEffect(() => {
    setCaptionText(caption);
  }, [caption]);

  const handleBlur = () => {
    if (name !== fileName || captionText !== caption) {
      onUpdate({
        fileName: name,
        caption: captionText,
      });
    }
  };

  const handleDone = () => {
    handleBlur();
    onClose();
  };

  return (
    <div className="space-y-3.5" data-testid="file-metadata-popover">
      <div>
        <label className="block text-xs font-medium text-foreground mb-1">
          Download File Name
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={handleBlur}
          placeholder="File display name..."
          className="w-full text-xs px-3 py-2 rounded-lg bg-background border border-border/70 focus:outline-none focus:ring-1 focus:ring-primary text-foreground placeholder:text-muted-foreground/60"
          dir="auto"
          aria-label="Download filename"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-foreground mb-1">
          Description / Caption (optional)
        </label>
        <input
          type="text"
          value={captionText}
          onChange={(e) => setCaptionText(e.target.value)}
          onBlur={handleBlur}
          placeholder="File description or instructions..."
          className="w-full text-xs px-3 py-2 rounded-lg bg-background border border-border/70 focus:outline-none focus:ring-1 focus:ring-primary text-foreground placeholder:text-muted-foreground/60"
          dir="auto"
          aria-label="File description"
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
