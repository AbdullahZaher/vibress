import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAdminLocale } from "../lib/admin-locale";
import { apiRequest } from "../lib/api";
import { AdminPageHeader } from "./common/AdminPageHeader";
import { EditorialListRow } from "./common/EditorialListRow";
import { EditorialStatusFilter } from "./common/EditorialStatusFilter";
import { EditorialChoiceMenu } from "./common/EditorialChoiceMenu";
import { EditorialPagination } from "./common/EditorialPagination";
import { readEditorialViewState, saveEditorialViewState } from "./common/editorial-view-state";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Dialog } from "./ui/dialog";
import { Plus, Search, FileText, AlertCircle, RefreshCw, Trash2, Send, X, ArrowDownUp, CheckSquare2 } from "lucide-react";

interface PageSummary {
  id: string;
  title: string;
  slug: string;
  status: string;
  publishedAt: string | null;
  scheduledAt?: string | null;
  updatedAt: string;
  authors?: Array<{ name: string; email: string }>;
}

type PageSortBy = "updatedAt" | "createdAt" | "publishedAt" | "title";
type BulkAction = "delete" | "publish" | "unpublish";
interface ConfirmAction {
  kind: BulkAction;
  ids: string[];
}

interface PagesListProps {
  onNavigate: (path: string) => void;
  canPublish: boolean;
  canViewAnalytics?: boolean;
  canCreate?: boolean;
  canEdit?: boolean;
  canDelete?: boolean;
  filterStatus?: string;
}

const STATUS_FILTERS = [
  { value: "all", label: "All Pages" },
  { value: "draft", label: "Drafts" },
  { value: "in_review", label: "In review" },
  { value: "changes_requested", label: "Changes requested" },
  { value: "scheduled", label: "Scheduled" },
  { value: "published", label: "Published" },
] as const;

export const PagesList: React.FC<PagesListProps> = ({
  onNavigate,
  canPublish,
  canCreate = false,
  canEdit = false,
  canDelete = false,
  filterStatus,
}) => {
  const { tr, formatNumber } = useAdminLocale();
  const [pages, setPages] = useState<PageSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [resolvedQueryKey, setResolvedQueryKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [initialView] = useState(() => readEditorialViewState("pages", filterStatus || "all"));
  const [statusFilter, setStatusFilter] = useState(initialView.status);
  const [searchQuery, setSearchQuery] = useState(initialView.search);
  const [debouncedSearch, setDebouncedSearch] = useState(initialView.search);
  const [page, setPage] = useState(initialView.page);
  const [pageSize, setPageSize] = useState(initialView.pageSize);
  const [sortBy, setSortBy] = useState<PageSortBy>(initialView.sortBy);
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">(initialView.sortOrder);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [processing, setProcessing] = useState(false);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const requestSequence = useRef(0);

  useEffect(() => {
    saveEditorialViewState("pages", { status: statusFilter, search: debouncedSearch, page, pageSize, sortBy, sortOrder });
  }, [statusFilter, debouncedSearch, page, pageSize, sortBy, sortOrder]);

  const previousSearch = useRef(initialView.search);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const nextSearch = searchQuery.trim();
      if (nextSearch !== previousSearch.current) {
        previousSearch.current = nextSearch;
        setDebouncedSearch(nextSearch);
        setPage(0);
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [page, pageSize, statusFilter, debouncedSearch, sortBy, sortOrder]);

  const queryKey = JSON.stringify([page, pageSize, sortBy, sortOrder, statusFilter, debouncedSearch]);
  const fetchPages = useCallback(async () => {
    const requestId = ++requestSequence.current;
    setLoading(true);
    setError(null);
    const query = new URLSearchParams({
      limit: String(pageSize),
      offset: String(page * pageSize),
      sortBy,
      sortOrder,
    });
    if (statusFilter !== "all") query.set("status", statusFilter);
    if (debouncedSearch) query.set("search", debouncedSearch);

    try {
      const data = await apiRequest<{ pages: PageSummary[]; total: number }>(`/pages?${query.toString()}`);
      if (requestId !== requestSequence.current) return;
      setPages(data.pages || []);
      setTotal(data.total || 0);
      setResolvedQueryKey(queryKey);
    } catch (err: unknown) {
      if (requestId !== requestSequence.current) return;
      setError(err instanceof Error ? err.message : tr("Failed to fetch pages"));
      setResolvedQueryKey(queryKey);
    } finally {
      if (requestId === requestSequence.current) setLoading(false);
    }
  }, [page, pageSize, sortBy, sortOrder, statusFilter, debouncedSearch, queryKey, tr]);

  useEffect(() => {
    void fetchPages();
    return () => { requestSequence.current += 1; };
  }, [fetchPages]);

  useEffect(() => {
    const lastPage = Math.max(0, Math.ceil(total / pageSize) - 1);
    if (page > lastPage) setPage(lastPage);
  }, [page, pageSize, total]);

  const visibleIds = useMemo(() => pages.map((item) => item.id), [pages]);
  const selectedPages = useMemo(() => pages.filter((item) => selectedIds.has(item.id)), [pages, selectedIds]);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
  const selectionEnabled = canDelete || canPublish;

  const toggleSelection = (id: string, selected: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (selected) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const handlePublishToggle = async (item: PageSummary) => {
    if (!canPublish || pendingIds.has(item.id)) return;
    setPendingIds((current) => new Set(current).add(item.id));
    setActionFeedback(null);
    try {
      const endpoint = item.status === "published"
        ? `/pages/${item.id}/unpublish`
        : `/pages/${item.id}/publish`;
      await apiRequest(endpoint, { method: "POST" });
      setActionFeedback({ type: "success", message: tr("Content status updated.") });
      await fetchPages();
    } catch (err: unknown) {
      setActionFeedback({ type: "error", message: err instanceof Error ? err.message : tr("Action failed") });
    } finally {
      setPendingIds((current) => {
        const next = new Set(current);
        next.delete(item.id);
        return next;
      });
    }
  };

  const runConfirmedAction = async () => {
    if (!confirmAction || processing) return;
    const action = confirmAction;
    const targets = pages.filter((item) => action.ids.includes(item.id)).filter((item) => {
      if (action.kind === "publish") return item.status !== "published";
      if (action.kind === "unpublish") return item.status === "published";
      return true;
    });
    if (!targets.length) {
      setConfirmAction(null);
      return;
    }
    setProcessing(true);
    setActionFeedback(null);
    const results = await Promise.allSettled(targets.map((item) => {
      if (action.kind === "delete") return apiRequest(`/pages/${item.id}`, { method: "DELETE" });
      const endpoint = action.kind === "publish" ? `/pages/${item.id}/publish` : `/pages/${item.id}/unpublish`;
      return apiRequest(endpoint, { method: "POST" });
    }));
    const failedIds = results.flatMap((result, index) => {
      const id = targets[index]?.id;
      return result.status === "rejected" && id ? [id] : [];
    });
    const failed = failedIds.length;
    const succeeded = results.length - failed;
    setConfirmAction(null);
    setSelectedIds(new Set(failedIds));
    setProcessing(false);
    setActionFeedback({
      type: failed ? "error" : "success",
      message: failed
        ? `${formatNumber(succeeded)} ${tr("completed")}, ${formatNumber(failed)} ${tr("failed")}. ${tr("Refresh and retry the remaining items.")}`
        : `${formatNumber(succeeded)} ${tr("items updated successfully")}.`,
    });
    await fetchPages();
  };

  const requestDelete = (id: string) => setConfirmAction({ kind: "delete", ids: [id] });
  const requestBulkAction = (kind: BulkAction) => {
    const ids = selectedPages
      .filter((item) => kind === "publish" ? item.status !== "published" : kind === "unpublish" ? item.status === "published" : true)
      .map((item) => item.id);
    if (ids.length) setConfirmAction({ kind, ids });
  };

  const actionTitle = confirmAction?.kind === "delete"
    ? tr("Delete selected content?")
    : confirmAction?.kind === "publish"
      ? tr("Publish selected content?")
      : tr("Unpublish selected content?");
  const actionDescription = confirmAction
    ? `${tr("You are about to")} ${confirmAction.kind === "delete" ? tr("delete") : confirmAction.kind === "publish" ? tr("publish") : tr("unpublish")} ${formatNumber(confirmAction.ids.length)} ${tr("items on this page")}.`
    : "";

  const resultsPending = loading || searchQuery.trim() !== debouncedSearch || resolvedQueryKey !== queryKey;

  return (
    <div className="mx-auto w-full max-w-6xl min-w-0 space-y-6">
      <AdminPageHeader
        title={tr("Pages")}
        actions={canCreate ? (
          <Button onClick={() => onNavigate("/admin/pages/new")} className="min-h-11 gap-2">
            <Plus className="size-4" aria-hidden="true" />{tr("New Page")}
          </Button>
        ) : undefined}
      />

      {actionFeedback && (
        <div role={actionFeedback.type === "error" ? "alert" : "status"} className={actionFeedback.type === "error" ? "flex items-start justify-between gap-3 rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive" : "flex items-start justify-between gap-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300"}>
          <p className="min-w-0">{actionFeedback.message}</p>
          <Button variant="ghost" size="icon-sm" onClick={() => setActionFeedback(null)} className="shrink-0" aria-label={tr("Dismiss")}>
            <X className="size-4" aria-hidden="true" />
          </Button>
        </div>
      )}

      <section className="vibress-editorial-filterbar space-y-3 py-2" aria-label={tr("Content filters")}>
        <div className="flex min-w-0 flex-wrap items-center gap-1.5 sm:gap-2">
          <div className="relative min-w-[9rem] flex-[1_1_13rem] sm:max-w-sm">
            <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              type="search"
              placeholder={tr("Search pages by title or slug...")}
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              aria-label={tr("Search pages by title or slug...")}
              className="min-h-11 w-full rounded-lg border-border/70 bg-card ps-9 text-sm"
            />
          </div>
          <EditorialStatusFilter
            label={tr("Filter")}
            options={STATUS_FILTERS.map(option => ({ value: option.value, label: tr(option.label) }))}
            value={statusFilter}
            onChange={(value) => { setStatusFilter(value); setPage(0); }}
          />
          <EditorialChoiceMenu
            label={tr("Sort")}
            options={(
              [
                ["updatedAt", "Recently updated"],
                ["createdAt", "Newest created"],
                ["publishedAt", "Publication date"],
                ["title", "Title"],
              ] as const
            ).flatMap(([field, title]) => [
              { value: `${field}:desc`, label: `${tr(title)} · ${tr("Descending")}` },
              { value: `${field}:asc`, label: `${tr(title)} · ${tr("Ascending")}` },
            ])}
            value={`${sortBy}:${sortOrder}`}
            onChange={(value) => {
              const [field, order] = value.split(":");
              setSortBy(field as PageSortBy);
              setSortOrder(order === "asc" ? "asc" : "desc");
              setPage(0);
            }}
            active={sortBy !== "updatedAt" || sortOrder !== "desc"}
            icon={<ArrowDownUp className="size-4" aria-hidden="true" />}
          />
          {selectionEnabled && (
            <Button
              type="button"
              variant={selectionMode || selectedIds.size > 0 ? "secondary" : "ghost"}
              size="sm"
              className="min-h-11 gap-2"
              aria-pressed={selectionMode}
              onClick={() => {
                setSelectionMode((active) => !active);
                setSelectedIds(new Set());
              }}
            >
              <CheckSquare2 className="size-4" aria-hidden="true" />
              {tr("Select")}
            </Button>
          )}
        </div>
        {(statusFilter !== "all" || sortBy !== "updatedAt" || sortOrder !== "desc") && (
          <div className="flex flex-wrap items-center gap-2" aria-label={tr("Active filters")}>
            {statusFilter !== "all" && (
              <button type="button" className="inline-flex min-h-9 items-center gap-1 rounded-full bg-muted px-3 text-xs font-medium text-foreground hover:bg-muted/70 focus-visible:outline-2 focus-visible:outline-ring" onClick={() => { setStatusFilter("all"); setPage(0); }}>
                {tr(STATUS_FILTERS.find(option => option.value === statusFilter)?.label || "All Pages")}
                <X className="size-3.5" aria-hidden="true" />
                <span className="sr-only">{tr("Clear filters")}</span>
              </button>
            )}
            {(sortBy !== "updatedAt" || sortOrder !== "desc") && (
              <button type="button" className="inline-flex min-h-9 items-center gap-1 rounded-full bg-muted px-3 text-xs font-medium text-foreground hover:bg-muted/70 focus-visible:outline-2 focus-visible:outline-ring" onClick={() => { setSortBy("updatedAt"); setSortOrder("desc"); setPage(0); }}>
                {tr("Sort")}: {tr(sortBy === "updatedAt" ? "Recently updated" : sortBy === "createdAt" ? "Newest created" : sortBy === "publishedAt" ? "Publication date" : "Title")}
                <X className="size-3.5" aria-hidden="true" />
                <span className="sr-only">{tr("Clear filters")}</span>
              </button>
            )}
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/50 pt-2">
          {selectionEnabled && !resultsPending && !error && pages.length > 0 && (
            <label className="inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={allVisibleSelected}
                disabled={resultsPending || pages.length === 0}
                onChange={(event) => {
                  const next = event.target.checked;
                  setSelectedIds(next ? new Set(visibleIds) : new Set());
                  if (next) setSelectionMode(true);
                }}
                aria-label={tr("Select all on this page")}
                className="size-4 accent-primary"
              />
              {tr("Select all on this page")}
            </label>
          )}
          <span aria-live="polite" className="text-sm text-muted-foreground">
            {resultsPending ? tr("Loading") : error ? tr("Results unavailable") : <>{tr("Showing")} {formatNumber(total)} {tr("pages")}</>}
          </span>
        </div>
        {!resultsPending && !error && selectedIds.size > 0 && (
          <div role="toolbar" aria-label={tr("Bulk actions")} className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 p-3">
            <span className="me-auto text-sm font-semibold text-foreground">{formatNumber(selectedIds.size)} {tr("selected on this page")}</span>
            {canPublish && selectedPages.some((item) => item.status !== "published") && (
              <Button type="button" size="sm" onClick={() => requestBulkAction("publish")} className="min-h-10 gap-1.5">
                <Send className="size-4" aria-hidden="true" /> {tr("Publish")}
              </Button>
            )}
            {canPublish && selectedPages.some((item) => item.status === "published") && (
              <Button type="button" size="sm" variant="outline" onClick={() => requestBulkAction("unpublish")} className="min-h-10">
                {tr("Unpublish")}
              </Button>
            )}
            {canDelete && (
              <Button type="button" size="sm" variant="destructive" onClick={() => requestBulkAction("delete")} className="min-h-10 gap-1.5">
                <Trash2 className="size-4" aria-hidden="true" /> {tr("Delete")}
              </Button>
            )}
            <Button type="button" size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())} className="min-h-10">
              {tr("Clear selection")}
            </Button>
          </div>
        )}
      </section>

      <section className="vibress-editorial-list min-w-0 overflow-visible bg-card" aria-label={tr("Pages")}>
        {resultsPending ? (
          <div role="status" aria-label={tr("Loading")} aria-busy="true">
            {[1, 2, 3, 4].map((item) => (
              <div key={item} className="flex min-h-[76px] items-center gap-4 border-b border-border/50 py-3 last:border-b-0">
                <span className="h-12 w-16 shrink-0 animate-pulse rounded-md bg-muted" />
                <span className="w-full max-w-sm space-y-2">
                  <span className="block h-4 w-2/3 animate-pulse rounded bg-muted" />
                  <span className="block h-3 w-1/2 animate-pulse rounded bg-muted/70" />
                </span>
              </div>
            ))}
          </div>
        ) : error ? (
          <div role="alert" className="flex flex-col items-start gap-3 py-12 text-sm">
            <div className="flex items-center gap-2 font-semibold text-destructive">
              <AlertCircle className="size-5" aria-hidden="true" />
              {tr("Unable to load static pages")}
            </div>
            <p className="max-w-xl break-words text-muted-foreground">{error}</p>
            <Button type="button" variant="outline" onClick={() => void fetchPages()} className="min-h-11 gap-2">
              <RefreshCw className="size-4" aria-hidden="true" />{tr("Try again")}
            </Button>
          </div>
        ) : pages.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 px-4 py-16 text-center text-muted-foreground">
            <FileText className="size-9 opacity-40" aria-hidden="true" />
            <p className="font-medium text-foreground">{searchQuery || statusFilter !== "all" ? tr("No pages found") : tr("No pages yet")}</p>
            <p className="max-w-md text-sm">
              {searchQuery || statusFilter !== "all"
                ? tr("Try a different search or filter.")
                : tr("Create your first page to get started.")}
            </p>
            {(searchQuery || statusFilter !== "all") && (
              <Button type="button" size="sm" variant="outline" className="min-h-11" onClick={() => { setSearchQuery(""); setDebouncedSearch(""); setStatusFilter("all"); setPage(0); }}>
                {tr("Clear filters")}
              </Button>
            )}
          </div>
        ) : (
          <div role="list" aria-label={tr("Pages")} className="min-w-0">
            {pages.map((item) => (
              <EditorialListRow
                key={item.id}
                title={item.title}
                resource="page"
                authorName={item.authors?.[0]?.name}
                date={item.status === "published" && item.publishedAt ? item.publishedAt : item.status === "scheduled" && item.scheduledAt ? item.scheduledAt : item.updatedAt}
                status={item.status}
                onEdit={canEdit ? () => onNavigate(`/admin/pages/${item.id}`) : undefined}
                editHref={canEdit ? `/admin/pages/${item.id}` : undefined}
                onPublishToggle={canPublish ? () => void handlePublishToggle(item) : undefined}
                onDelete={canDelete ? () => requestDelete(item.id) : undefined}
                onSelect={selectionEnabled ? (selected) => { toggleSelection(item.id, selected); if (selected) setSelectionMode(true); } : undefined}
                selectionMode={selectionMode}
                selected={selectedIds.has(item.id)}
                selectionLabel={`${tr("Select")}: ${item.title || tr("(Untitled)")}`}
              />
            ))}
          </div>
        )}
      </section>

      {!resultsPending && !error && (
      <EditorialPagination
        page={page}
        pageSize={pageSize}
        total={total}
        onPageChange={setPage}
        onPageSizeChange={(size) => { setPageSize(size); setPage(0); }}
      />
      )}

      <Dialog
        isOpen={!!confirmAction}
        onClose={() => { if (!processing) setConfirmAction(null); }}
        title={actionTitle}
        description={actionDescription}
        className="max-w-md"
      >
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" disabled={processing} onClick={() => setConfirmAction(null)}>
            {tr("Cancel")}
          </Button>
          <Button
            type="button"
            variant={confirmAction?.kind === "delete" ? "destructive" : "default"}
            disabled={processing}
            onClick={() => void runConfirmedAction()}
          >
            {processing ? tr("Processing...") : confirmAction?.kind === "delete" ? tr("Confirm delete") : confirmAction?.kind === "publish" ? tr("Confirm publish") : tr("Confirm unpublish")}
          </Button>
        </div>
      </Dialog>
    </div>
  );
};
