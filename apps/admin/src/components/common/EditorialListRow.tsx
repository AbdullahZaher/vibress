import { useEffect, useId, useRef, useState } from "react";
import { BarChart3, ImageIcon, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { useAdminLocale } from "../../lib/admin-locale";
import { IconButton } from "../ui/icon-button";
import { Badge } from "../ui/badge";

export interface EditorialListRowProps {
  title: string;
  authorName?: string | null | undefined;
  date: string;
  status: string;
  imageUrl?: string | null | undefined;
  featured?: boolean | undefined;
  onEdit?: (() => void) | undefined;
  /** Opens existing analytics dashboard, if the user has analytics.read permission. */
  onStatistics?: (() => void) | undefined;
  onPublishToggle?: (() => void) | undefined;
  onDelete?: (() => void) | undefined;
  selected?: boolean | undefined;
  onSelect?: ((selected: boolean) => void) | undefined;
  selectionLabel?: string | undefined;
}

/** Shared, responsive editorial row for posts and pages. Actions remain explicit and permission-driven. */
export function EditorialListRow({
  title, authorName, date, status, imageUrl, featured = false,
  onEdit, onStatistics, onPublishToggle, onDelete, selected = false, onSelect, selectionLabel,
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
  const badgeVariant = status === "published"
    ? "published"
    : status === "draft"
      ? "draft"
      : status === "scheduled"
        ? "scheduled"
        : status === "in_review" || status === "changes_requested"
          ? "review"
          : "outline";

  return (
    <div role="listitem" className="group relative flex items-center gap-2 px-3 py-2 transition-colors hover:bg-muted/30 focus-within:z-20 focus-within:bg-muted/30 sm:gap-3.5 sm:py-2.5 border-b border-border/40 last:border-b-0">
      {/* A sibling button covers the row; actions are stacked above it. Avoid nested interactive controls. */}
      {onEdit && (
        <button
          type="button"
          onClick={onEdit}
          aria-label={`${tr("Edit")}: ${displayTitle}`}
          className="absolute inset-0 z-0 cursor-pointer rounded-md focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
        />
      )}
      {onSelect && (
        <label className="relative z-10 inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-lg hover:bg-muted/60">
          <input
            type="checkbox"
            checked={selected}
            onChange={(event) => onSelect(event.target.checked)}
            aria-label={selectionLabel || `${tr("Select")}: ${displayTitle}`}
            className="size-4 accent-primary"
          />
        </label>
      )}
      <div className="flex h-12 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border/60 bg-muted/50 text-muted-foreground/60 sm:h-14 sm:w-20 shadow-2xs">
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
          <ImageIcon className="size-4 sm:size-5" aria-hidden="true" />
        )}
      </div>

      <div className="min-w-0 flex-1 space-y-1 text-start">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <h3 dir="auto" className="max-w-full break-words text-start text-sm font-semibold leading-tight text-foreground transition-colors group-hover:text-primary">
            {displayTitle}
          </h3>
          {featured && (
            <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary text-[10px] font-semibold py-0 px-1.5">
              {tr("Featured")}
            </Badge>
          )}
        </div>
        <p className="text-xs leading-4 text-muted-foreground">
          {authorName && (
            <>
              {tr("By")} <span dir="auto">{authorName}</span>
              <span aria-hidden="true"> · </span>
            </>
          )}
          <time dateTime={date}>{formatDate(date, { day: "numeric", month: "short", year: "numeric" })}</time>
        </p>
        <div className="pt-0.5">
          <Badge variant={badgeVariant} className="text-[11px] font-medium py-0 px-2 rounded-md">
            {statusLabels[status] ?? tr("Draft")}
          </Badge>
        </div>
      </div>

      <div className="relative z-10 flex shrink-0 items-center gap-1 sm:gap-1.5">
        {isPublished && onStatistics ? (
          <IconButton
            label={tr("Analytics Dashboard")}
            accessibleLabel={`${tr("Analytics Dashboard")}: ${displayTitle}`}
            variant="outline"
            onClick={onStatistics}
            className="h-10 w-10 rounded-lg"
          >
            <BarChart3 className="size-4" aria-hidden="true" />
          </IconButton>
        ) : onEdit ? (
          <IconButton
            label={tr("Edit")}
            accessibleLabel={`${tr("Edit")}: ${displayTitle}`}
            variant="outline"
            onClick={onEdit}
            className="h-10 w-10 rounded-lg"
          >
            <Pencil className="size-4" aria-hidden="true" />
          </IconButton>
        ) : null}
        {(onPublishToggle || onDelete) && <div ref={actionsRef} className="relative">
          <button
            ref={triggerRef}
            type="button"
            aria-label={`${tr("More actions")}: ${displayTitle}`}
            aria-expanded={actionsOpen}
            aria-controls={actionsId}
            title={tr("More actions")}
            onClick={() => setActionsOpen((open) => !open)}
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
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
                  className="flex min-h-10 w-full items-center rounded-md px-3 text-start text-sm hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
                >
                  {publishLabel}
                </button>
              )}
              {onDelete && (
                <button
                  type="button"
                  onClick={() => { setActionsOpen(false); onDelete(); }}
                  className="flex min-h-10 w-full items-center gap-2 rounded-md px-3 text-start text-sm text-destructive hover:bg-destructive/10 focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                  {tr("Delete")}
                </button>
              )}
            </div>
          )}
        </div>}
      </div>
    </div>
  );
}
