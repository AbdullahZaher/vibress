import { useEffect, useId, useRef, useState } from "react";
import { BarChart3, ImageIcon, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { useAdminLocale } from "../../lib/admin-locale";
import { IconButton } from "../ui/icon-button";

export interface EditorialListRowProps {
  title: string;
  authorName?: string | null | undefined;
  date: string;
  status: string;
  imageUrl?: string | null | undefined;
  featured?: boolean | undefined;
  onEdit: () => void;
  /** Opens existing analytics dashboard, if the user has analytics.read permission. */
  onStatistics?: (() => void) | undefined;
  onPublishToggle?: (() => void) | undefined;
  onDelete: () => void;
}

/** Shared, responsive editorial row for posts and pages. Actions remain explicit and permission-driven. */
export function EditorialListRow({
  title, authorName, date, status, imageUrl, featured = false,
  onEdit, onStatistics, onPublishToggle, onDelete,
}: EditorialListRowProps) {
  const { tr, formatDate } = useAdminLocale();
  const [imageFailed, setImageFailed] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const actionsId = useId();
  const actionsRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => { setImageFailed(false); }, [imageUrl]);

  useEffect(() => {
    if (!actionsOpen) return;
    const dismissOnPointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !actionsRef.current?.contains(event.target)) {
        setActionsOpen(false);
      }
    };
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setActionsOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", dismissOnPointer);
    document.addEventListener("keydown", dismissOnEscape);
    return () => {
      document.removeEventListener("pointerdown", dismissOnPointer);
      document.removeEventListener("keydown", dismissOnEscape);
    };
  }, [actionsOpen]);

  const displayTitle = title.trim() || tr("(Untitled)");
  const isPublished = status === "published";
  const publishLabel = isPublished ? tr("Unpublish") : tr("Publish");
  const statusLabels: Record<string, string> = {
    draft: tr("Draft"),
    published: tr("Published"),
    scheduled: tr("Scheduled"),
    in_review: tr("In review"),
    changes_requested: tr("Changes requested"),
    approved: tr("Approved"),
    archived: tr("Archived"),
  };
  const statusColor = status === "draft"
    ? "text-pink-500"
    : status === "scheduled"
      ? "text-amber-500"
      : status === "published"
        ? "text-muted-foreground"
        : "text-primary";

  return (
    <div role="listitem" className="group relative flex items-center gap-3 px-1 py-3 transition-colors hover:bg-muted/20 focus-within:z-20 focus-within:bg-muted/20 sm:gap-4 sm:py-3.5">
      {/* A sibling button covers the row; actions are stacked above it. Avoid nested interactive controls. */}
      <button
        type="button"
        onClick={onEdit}
        aria-label={`${tr("Edit")}: ${displayTitle}`}
        className="absolute inset-0 z-0 cursor-pointer rounded-md focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
      />
      <div className="flex h-14 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted/70 text-muted-foreground/60 sm:h-20 sm:w-28">
        {imageUrl && !imageFailed ? (
          <img
            src={imageUrl}
            alt=""
            loading="lazy"
            decoding="async"
            onError={() => setImageFailed(true)}
            className="h-full w-full object-cover"
          />
        ) : (
          <ImageIcon className="size-5 sm:size-6" aria-hidden="true" />
        )}
      </div>

      <div className="min-w-0 flex-1 space-y-0.5 text-start">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <h3 dir="auto" className="max-w-full break-words text-start text-sm font-semibold leading-snug text-foreground transition-colors group-hover:text-primary sm:text-base">
            {displayTitle}
          </h3>
          {featured && (
            <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
              {tr("Featured")}
            </span>
          )}
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {authorName && (
            <>
              {tr("By")} <span dir="auto">{authorName}</span>
              <span aria-hidden="true"> · </span>
            </>
          )}
          <time dateTime={date}>{formatDate(date, { day: "numeric", month: "short", year: "numeric" })}</time>
        </p>
        <p className={`text-xs font-medium ${statusColor}`}>
          {statusLabels[status] ?? tr("Draft")}
        </p>
      </div>

      <div className="relative z-10 flex shrink-0 items-center gap-1 sm:gap-1.5">
        {isPublished && onStatistics ? (
          <IconButton
            label={tr("Analytics Dashboard")}
            accessibleLabel={`${tr("Analytics Dashboard")}: ${displayTitle}`}
            variant="outline"
            onClick={onStatistics}
            className="h-9 w-9 rounded-lg"
          >
            <BarChart3 className="size-4" aria-hidden="true" />
          </IconButton>
        ) : (
          <IconButton
            label={tr("Edit")}
            accessibleLabel={`${tr("Edit")}: ${displayTitle}`}
            variant="outline"
            onClick={onEdit}
            className="h-9 w-9 rounded-lg"
          >
            <Pencil className="size-4" aria-hidden="true" />
          </IconButton>
        )}
        <div ref={actionsRef} className="relative">
          <button
            ref={triggerRef}
            type="button"
            aria-label={`${tr("More actions")}: ${displayTitle}`}
            aria-expanded={actionsOpen}
            aria-controls={actionsId}
            title={tr("More actions")}
            onClick={() => setActionsOpen((open) => !open)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            <MoreHorizontal className="size-4" aria-hidden="true" />
          </button>
          {actionsOpen && (
            <div
              id={actionsId}
              role="group"
              aria-label={tr("More actions")}
              className="absolute end-0 top-full z-30 mt-1 min-w-44 rounded-lg border border-border bg-popover p-1.5 text-popover-foreground shadow-xl"
            >
              {onPublishToggle && (
                <button
                  type="button"
                  onClick={() => { setActionsOpen(false); onPublishToggle(); }}
                  className="flex min-h-9 w-full items-center rounded-md px-3 text-start text-sm hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
                >
                  {publishLabel}
                </button>
              )}
              <button
                type="button"
                onClick={() => { setActionsOpen(false); onDelete(); }}
                className="flex min-h-9 w-full items-center gap-2 rounded-md px-3 text-start text-sm text-destructive hover:bg-destructive/10 focus-visible:outline-2 focus-visible:outline-ring"
              >
                <Trash2 className="size-4" aria-hidden="true" />
                {tr("Delete")}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
