import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { FileText, Image as ImageIcon, MoreHorizontal, Trash2 } from "lucide-react";
import { Button } from "../ui/button";
import { useAdminLocale } from "../../lib/admin-locale";
import { cn } from "@/lib/utils";
import { EditorialSelectionCheckbox } from "./EditorialSelectionCheckbox";

export interface EditorialListRowProps {
  title: string;
  resource?: "post" | "page" | undefined;
  authorName?: string | null | undefined;
  date: string;
  status: string;
  imageUrl?: string | null | undefined;
  featured?: boolean | undefined;
  onEdit?: (() => void) | undefined;
  editHref?: string | undefined;
  selectionMode?: boolean | undefined;
  onPublishToggle?: (() => void) | undefined;
  onDelete?: (() => void) | undefined;
  selected?: boolean | undefined;
  onSelect?: ((selected: boolean) => void) | undefined;
  selectionLabel?: string | undefined;
}

/** Shared, responsive editorial row for posts and pages. Actions remain explicit and permission-driven. */
export function EditorialListRow({
  title, resource = "post", authorName, date, status, imageUrl, featured = false,
  onEdit, editHref, onPublishToggle, onDelete, selected = false, selectionMode = false, onSelect, selectionLabel,
}: EditorialListRowProps) {
  const { tr, formatDate } = useAdminLocale();
  const [imageFailed, setImageFailed] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const actionsId = useId();
  const actionsRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number; maxHeight: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => { setImageFailed(false); }, [imageUrl]);

  const toggleMenu = () => {
    if (actionsOpen) {
      setActionsOpen(false);
      return;
    }
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const menuWidth = Math.min(192, window.innerWidth - 16);
    const availableBelow = window.innerHeight - rect.bottom;
    const openAbove = availableBelow < 112 && rect.top > availableBelow;
    const leftUnclamped = getComputedStyle(trigger).direction === "rtl"
      ? rect.left
      : rect.right - menuWidth;
    const left = Math.max(8, Math.min(window.innerWidth - menuWidth - 8, leftUnclamped));
    const top = openAbove ? Math.max(8, rect.top - 112 - 6) : Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - 112 - 8));
    setMenuPosition({ top, left, maxHeight: Math.max(72, window.innerHeight - top - 8) });
    setActionsOpen(true);
  };

  useEffect(() => {
    if (!actionsOpen) return;
    const dismissOnPointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !actionsRef.current?.contains(event.target) && !menuRef.current?.contains(event.target)) {
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
    menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const dismissOnScroll = () => setActionsOpen(false);
    const dismissOnFocus = (event: FocusEvent) => {
      if (event.target instanceof Node && !actionsRef.current?.contains(event.target) && !menuRef.current?.contains(event.target)) {
        setActionsOpen(false);
      }
    };
    document.addEventListener("focusin", dismissOnFocus);
    document.addEventListener("pointerdown", dismissOnPointer);
    window.addEventListener("scroll", dismissOnScroll, true);
    window.addEventListener("resize", dismissOnScroll);
    document.addEventListener("keydown", dismissOnEscape);
    return () => {
      document.removeEventListener("focusin", dismissOnFocus);
      document.removeEventListener("pointerdown", dismissOnPointer);
      window.removeEventListener("scroll", dismissOnScroll, true);
      window.removeEventListener("resize", dismissOnScroll);
      document.removeEventListener("keydown", dismissOnEscape);
    };
  }, [actionsOpen]);

  const handleMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const buttons = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
    if (!buttons.length) return;
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      buttons[(index + delta + buttons.length) % buttons.length]?.focus();
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      buttons[event.key === "Home" ? 0 : buttons.length - 1]?.focus();
    } else if (event.key === "Tab") {
      setActionsOpen(false);
    }
  };

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
  const statusColor = status === "published"
    ? "text-muted-foreground"
    : status === "scheduled"
      ? "text-status-scheduled-fg"
      : status === "in_review" || status === "changes_requested"
        ? "text-status-review-fg"
        : "text-muted-foreground";

  const handleRowClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!selectionMode || !onSelect) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('button, a, input, label, [role="menu"], [role="menuitem"]')) {
      return;
    }
    onSelect(!selected);
  };

  return (
    <div
      role="listitem"
      data-selected={selected ? "true" : undefined}
      onClick={handleRowClick}
      className={cn(
        "group relative flex min-h-[80px] items-center gap-3 border-b border-border/50 px-2 sm:px-3 py-2.5 transition-colors sm:gap-4 last:border-b-0",
        "hover:bg-muted/20 focus-within:z-20 focus-within:bg-muted/20",
        selected && "bg-primary/[0.035] dark:bg-primary/[0.055]",
        (selectionMode ? onSelect : onEdit) && "cursor-pointer"
      )}
    >
      {/* Sibling edit link/button: rendered only when selection mode is inactive so row editing never activates during selection */}
      {!selectionMode && onEdit && (editHref ? (
        <a
          href={editHref}
          onClick={(event) => {
            if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
              event.preventDefault();
              onEdit();
            }
          }}
          aria-label={`${tr("Edit")}: ${displayTitle}`}
          className="absolute inset-0 z-0 rounded-md focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
        />
      ) : (
        <button
          type="button"
          onClick={onEdit}
          aria-label={`${tr("Edit")}: ${displayTitle}`}
          className="absolute inset-0 z-0 cursor-pointer rounded-md focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
        />
      ))}
      {selectionMode && onSelect && (
        <div className="relative z-20 flex shrink-0 items-center justify-center">
          <EditorialSelectionCheckbox
            checked={selected}
            onChange={onSelect}
            label={selectionLabel || `${tr("Select")}: ${displayTitle}`}
          />
        </div>
      )}
      <div className="flex h-12 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted/60 text-muted-foreground/50 sm:h-14 sm:w-20" aria-hidden="true">
        {imageUrl && !imageFailed ? (
          <img src={imageUrl} alt="" loading="lazy" decoding="async" onError={() => setImageFailed(true)} className="h-full w-full object-cover" />
        ) : resource === "page" ? <FileText className="size-4" /> : <ImageIcon className="size-4" />}
      </div>

      <div className="min-w-0 flex-1 space-y-1.5 text-start">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <h3 dir="auto" className="max-w-full break-words text-start text-base font-semibold leading-snug text-foreground transition-colors group-hover:underline group-hover:underline-offset-4">
            {displayTitle}
          </h3>
          {featured && (
            <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-foreground">
              {tr("Featured")}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm leading-5 text-muted-foreground">
          {authorName && (
            <>
              <span>{tr("By")} <span dir="auto">{authorName}</span></span>
              <span aria-hidden="true">·</span>
            </>
          )}
          <time dateTime={date}>{formatDate(date, { day: "numeric", month: "short", year: "numeric" })}</time>
          <span aria-hidden="true">·</span>
          <span className={`font-medium ${statusColor}`}>{statusLabels[status] ?? (status.replace(/_/g, " ").trim() || tr("Unknown status"))}</span>
        </div>
      </div>

      <div className="relative z-10 flex shrink-0 items-center gap-1 sm:gap-1.5">
        {(onPublishToggle || onDelete) && <div ref={actionsRef} className="relative">
          <Button
            ref={triggerRef}
            variant="ghost"
            size="icon"
            aria-label={`${tr("More actions")}: ${displayTitle}`}
            aria-expanded={actionsOpen}
            aria-controls={actionsId}
            aria-haspopup="menu"
            title={tr("More actions")}
            onClick={toggleMenu}
            className="text-muted-foreground"
          >
            <MoreHorizontal className="size-4" aria-hidden="true" />
          </Button>
          {actionsOpen && menuPosition && createPortal(
            <div
              ref={menuRef}
              id={actionsId}
              role="menu"
              aria-label={tr("More actions")}
              onKeyDown={handleMenuKeyDown}
              className="fixed z-[90] min-w-44 overflow-y-auto rounded-lg border border-border bg-popover p-1.5 text-popover-foreground shadow-lg"
              style={{ top: menuPosition.top, left: menuPosition.left, width: Math.min(192, window.innerWidth - 16), maxHeight: menuPosition.maxHeight }}
            >
              {onPublishToggle && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => { setActionsOpen(false); onPublishToggle(); }}
                  className="flex min-h-10 w-full items-center rounded-md px-3 text-start text-sm hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
                >
                  {publishLabel}
                </button>
              )}
              {onDelete && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => { setActionsOpen(false); onDelete(); }}
                  className="flex min-h-10 w-full items-center gap-2 rounded-md px-3 text-start text-sm text-destructive hover:bg-destructive/10 focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                  {tr("Delete")}
                </button>
              )}
            </div>,
            document.body,
          )}
        </div>}
      </div>
    </div>
  );
}
