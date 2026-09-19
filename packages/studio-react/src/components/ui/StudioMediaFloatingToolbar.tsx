import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  RefreshCw,
  Sparkles,
  Info,
  ChevronDown,
  ChevronUp,
  Trash2,
  Minimize2,
  Maximize2,
  Move,
} from "lucide-react";

export interface StudioMediaFloatingToolbarProps {
  /** Change media callback (opens library picker) */
  onChange?: (() => void | Promise<void>) | undefined;
  changeLabel?: string | undefined;
  changeTitle?: string | undefined;
  changeDisabled?: boolean | undefined;

  /** Unsplash selection callback (only for images) */
  onUnsplash?: (() => void | Promise<void>) | undefined;
  unsplashDisabled?: boolean | undefined;

  /** Metadata toggle & content */
  metadataLabel?: string | undefined;
  metadataTitle?: string | undefined;
  metadataContent?: React.ReactNode | undefined;

  /** Width layout controls */
  width?: ("regular" | "wide" | "full") | undefined;
  onWidthChange?: ((width: "regular" | "wide" | "full") => void) | undefined;

  /** Delete / remove media callback */
  onDelete?: (() => void) | undefined;
  deleteTitle?: string | undefined;
  deleteDisabled?: boolean | undefined;

  /** Selection / focus state from card */
  isSelected?: boolean | undefined;
  disabled?: boolean | undefined;
  className?: string | undefined;
  children?: React.ReactNode | undefined;
}

export const StudioMediaFloatingToolbar: React.FC<
  StudioMediaFloatingToolbarProps
> = ({
  onChange,
  changeLabel = "Change",
  changeTitle = "Change image from library",
  changeDisabled = false,
  onUnsplash,
  unsplashDisabled = false,
  metadataLabel = "Alt / Caption",
  metadataTitle = "Edit alt text and caption",
  metadataContent,
  width,
  onWidthChange,
  onDelete,
  deleteTitle = "Remove media",
  deleteDisabled = false,
  isSelected = false,
  disabled = false,
  className = "",
  children,
}) => {
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const metadataBtnRef = useRef<HTMLButtonElement>(null);

  // Close popover on outside click
  useEffect(() => {
    if (!isPopoverOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsPopoverOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside, true);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside, true);
    };
  }, [isPopoverOpen]);

  // Close on Escape and refocus metadata button
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape" && isPopoverOpen) {
        e.preventDefault();
        e.stopPropagation();
        setIsPopoverOpen(false);
        metadataBtnRef.current?.focus();
      }
    },
    [isPopoverOpen],
  );

  return (
    <div
      ref={containerRef}
      role="toolbar"
      aria-label="Media controls"
      data-studio-toolbar="true"
      onKeyDown={handleKeyDown}
      className={`studio-glassy-menu absolute top-3 end-3 flex items-center gap-1.5 p-1.5 rounded-xl bg-background/85 dark:bg-card/90 backdrop-blur-md border border-border/80 shadow-lg select-none z-40 transition-all duration-150 opacity-90 sm:opacity-0 group-hover:opacity-100 focus-within:opacity-100 ${
        isSelected || isPopoverOpen ? "!opacity-100" : ""
      } ${className}`}
    >
      {/* 1. Change Button */}
      {onChange && (
        <button
          type="button"
          disabled={disabled || changeDisabled}
          onClick={onChange}
          className="h-7 px-2.5 text-xs font-medium gap-1.5 rounded-md hover:bg-muted text-foreground transition-colors inline-flex items-center justify-center cursor-pointer disabled:opacity-50 disabled:pointer-events-none"
          title={changeTitle}
          aria-label={changeTitle}
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">{changeLabel}</span>
        </button>
      )}

      {/* 2. Unsplash Button (images only) */}
      {onUnsplash && (
        <button
          type="button"
          disabled={disabled || unsplashDisabled}
          onClick={onUnsplash}
          className="h-7 px-2.5 text-xs font-medium gap-1.5 rounded-md hover:bg-muted text-amber-600 dark:text-amber-400 transition-colors inline-flex items-center justify-center cursor-pointer disabled:opacity-50 disabled:pointer-events-none"
          title="Replace from Unsplash"
          aria-label="Replace from Unsplash"
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Unsplash</span>
        </button>
      )}

      {/* 3. Metadata / Popover Toggle Button */}
      {metadataContent && (
        <button
          ref={metadataBtnRef}
          type="button"
          disabled={disabled}
          onClick={() => setIsPopoverOpen((prev) => !prev)}
          className={`h-7 px-2 text-xs font-medium gap-1 rounded-md hover:bg-muted text-foreground transition-colors inline-flex items-center justify-center cursor-pointer ${
            isPopoverOpen ? "bg-muted text-foreground" : ""
          }`}
          title={metadataTitle}
          aria-label={metadataTitle}
          aria-expanded={isPopoverOpen}
          aria-haspopup="dialog"
        >
          <Info className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">{metadataLabel}</span>
          {isPopoverOpen ? (
            <ChevronUp className="w-3 h-3 opacity-70" />
          ) : (
            <ChevronDown className="w-3 h-3 opacity-70" />
          )}
        </button>
      )}

      {/* 4. Width Controls (regular | wide | full) */}
      {onWidthChange && (
        <>
          <div className="w-px h-4 bg-border/60 mx-0.5" />
          <button
            type="button"
            disabled={disabled}
            onClick={() => onWidthChange("regular")}
            className={`h-7 px-1.5 text-xs rounded-md inline-flex items-center justify-center transition-colors ${
              width === "regular" || !width
                ? "bg-muted text-primary font-semibold"
                : "text-muted-foreground hover:bg-muted/60"
            }`}
            title="Regular width"
            aria-label="Regular layout width"
          >
            <Minimize2 className="w-3 h-3" />
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onWidthChange("wide")}
            className={`h-7 px-1.5 text-xs rounded-md inline-flex items-center justify-center transition-colors ${
              width === "wide"
                ? "bg-muted text-primary font-semibold"
                : "text-muted-foreground hover:bg-muted/60"
            }`}
            title="Wide width"
            aria-label="Wide layout width"
          >
            <Move className="w-3 h-3" />
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onWidthChange("full")}
            className={`h-7 px-1.5 text-xs rounded-md inline-flex items-center justify-center transition-colors ${
              width === "full"
                ? "bg-muted text-primary font-semibold"
                : "text-muted-foreground hover:bg-muted/60"
            }`}
            title="Full screen width"
            aria-label="Full layout width"
          >
            <Maximize2 className="w-3 h-3" />
          </button>
        </>
      )}

      {/* Optional Custom Actions */}
      {children}

      {/* 5. Delete Action */}
      {onDelete && (
        <>
          <div className="w-px h-4 bg-border/60 mx-0.5" />
          <button
            type="button"
            disabled={disabled || deleteDisabled}
            onClick={onDelete}
            className="h-7 px-2 text-xs font-medium text-destructive hover:bg-destructive/10 hover:text-destructive rounded-md transition-colors inline-flex items-center justify-center cursor-pointer disabled:opacity-50 disabled:pointer-events-none"
            title={deleteTitle}
            aria-label={deleteTitle}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </>
      )}

      {/* 6. Contextual Metadata Popover */}
      {isPopoverOpen && metadataContent && (
        <div
          role="dialog"
          aria-label={metadataTitle}
          className="absolute top-full mt-2 end-0 z-50 w-80 sm:w-96 max-w-[calc(100vw-2rem)] rounded-xl bg-background/95 dark:bg-card/95 backdrop-blur-md border border-border/80 shadow-2xl p-4 text-xs animate-in fade-in zoom-in-95 duration-150 text-foreground"
        >
          {React.cloneElement(metadataContent as React.ReactElement, {
            onClose: () => setIsPopoverOpen(false),
          })}
        </div>
      )}
    </div>
  );
};
