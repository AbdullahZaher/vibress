import { RotateCcw, Send, Trash2, X } from "lucide-react";
import { useAdminLocale } from "../../lib/admin-locale";
import { Button } from "../ui/button";

export type EditorialBulkAction = "publish" | "unpublish" | "delete";

interface EditorialBulkActionsProps {
  selectedCount: number;
  showPublish: boolean;
  showUnpublish: boolean;
  showDelete: boolean;
  onAction: (action: EditorialBulkAction) => void;
  onClear: () => void;
}

/**
 * One shared bulk-action surface for Posts and Pages.
 * Equal height, width, radius and typography within the group;
 * visual danger emphasis happens on intent, not as a competing solid CTA.
 */
export function EditorialBulkActions({
  selectedCount, showPublish, showUnpublish, showDelete, onAction, onClear,
}: EditorialBulkActionsProps) {
  const { tr, formatNumber } = useAdminLocale();
  if (selectedCount <= 0) return null;

  const actionClass = "min-h-11 w-full min-w-0 gap-2 px-3 text-sm font-medium";
  return (
    <div
      role="toolbar"
      aria-label={tr("Bulk actions")}
      className="flex min-w-0 flex-wrap items-center gap-3 rounded-xl border border-border/70 bg-muted/20 p-3 sm:p-3.5"
    >
      <span className="min-w-0 flex-1 text-sm font-semibold text-foreground">
        {formatNumber(selectedCount)} {tr("selected on this page")}
      </span>
      <div className="grid w-full grid-cols-1 gap-2 min-[420px]:grid-cols-2 lg:w-auto lg:grid-flow-col lg:auto-cols-[minmax(9rem,1fr)] lg:grid-cols-none">
        {showPublish && (
          <Button variant="outline" size="default" className={actionClass} onClick={() => onAction("publish")}>
            <Send className="size-4 shrink-0" aria-hidden="true" />
            {tr("Publish")}
          </Button>
        )}
        {showUnpublish && (
          <Button variant="outline" size="default" className={actionClass} onClick={() => onAction("unpublish")}>
            <RotateCcw className="size-4 shrink-0" aria-hidden="true" />
            {tr("Unpublish")}
          </Button>
        )}
        {showDelete && (
          <Button variant="destructive-outline" size="default" className={actionClass} onClick={() => onAction("delete")}>
            <Trash2 className="size-4 shrink-0" aria-hidden="true" />
            {tr("Delete")}
          </Button>
        )}
        <Button variant="outline" size="default" className={actionClass} onClick={onClear}>
          <X className="size-4 shrink-0" aria-hidden="true" />
          {tr("Clear selection")}
        </Button>
      </div>
    </div>
  );
}
