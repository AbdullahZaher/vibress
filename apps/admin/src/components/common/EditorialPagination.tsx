import React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useAdminLocale } from "../../lib/admin-locale";
import { Button } from "../ui/button";

interface EditorialPaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}

export function EditorialPagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
}: EditorialPaginationProps) {
  const { tr, formatNumber } = useAdminLocale();
  if (total <= 0) return null;

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const firstItem = currentPage * pageSize + 1;
  const lastItem = Math.min(total, (currentPage + 1) * pageSize);

  return (
    <div className="flex min-w-0 flex-col gap-3 border-t border-border/70 pt-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-xs leading-relaxed text-muted-foreground" role="status" aria-live="polite">
        {tr("Showing")} {formatNumber(firstItem)}–{formatNumber(lastItem)} {tr("of")} {formatNumber(total)}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{tr("Rows per page")}</span>
          <select
            value={pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
            className="min-h-11 rounded-lg border border-border bg-card px-2.5 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-ring"
            aria-label={tr("Rows per page")}
          >
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
        </label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-11"
          disabled={currentPage <= 0}
          onClick={() => onPageChange(currentPage - 1)}
        >
          <ChevronLeft className="size-4 rtl:rotate-180" aria-hidden="true" />
          {tr("Previous")}
        </Button>
        <span className="min-w-16 text-center text-xs tabular-nums text-muted-foreground">
          {formatNumber(currentPage + 1)} / {formatNumber(pageCount)}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-11"
          disabled={currentPage >= pageCount - 1}
          onClick={() => onPageChange(currentPage + 1)}
        >
          {tr("Next")}
          <ChevronRight className="size-4 rtl:rotate-180" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
