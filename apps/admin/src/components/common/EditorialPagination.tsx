import { ChevronLeft, ChevronRight } from "lucide-react";
import { EditorialChoiceMenu } from "./EditorialChoiceMenu";
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
      <p className="text-sm leading-relaxed text-muted-foreground" role="status" aria-live="polite">
        {tr("Showing")} {formatNumber(firstItem)}–{formatNumber(lastItem)} {tr("of")} {formatNumber(total)}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <EditorialChoiceMenu
          label={`${formatNumber(pageSize)} ${tr("Rows per page")}`}
          options={[25, 50, 100].map(size => ({ value: String(size), label: `${formatNumber(size)} ${tr("Rows per page")}` }))}
          value={String(pageSize)}
          onChange={(value) => onPageSizeChange(Number(value))}
          compact
        />
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
        <span className="min-w-16 text-center text-sm tabular-nums text-muted-foreground">
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
