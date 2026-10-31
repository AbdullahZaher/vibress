import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAdminLocale } from "../lib/admin-locale";
import { apiRequest } from "../lib/api";
import { AdminPageHeader } from "./common/AdminPageHeader";
import { EditorialListRow } from "./common/EditorialListRow";
import { EditorialPagination } from "./common/EditorialPagination";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Dialog } from "./ui/dialog";
import { Plus, Search, FileCode, AlertCircle, RefreshCw, Trash2, Send, X } from "lucide-react";

interface PageSummary {
  id: string;
  title: string;
  slug: string;
  status: string;
  publishedAt: string | null;
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
  { value: "all", label: "All" },
  { value: "draft", label: "Drafts" },
  { value: "in_review", label: "In review" },
  { value: "changes_requested", label: "Changes requested" },
  { value: "scheduled", label: "Scheduled" },
  { value: "published", label: "Published" },
] as const;

export const PagesList: React.FC<PagesListProps> = ({
  onNavigate,
  canPublish,
  canViewAnalytics = false,
  canCreate = false,
  canEdit = false,
  canDelete = false,
  filterStatus,
}) => {
  const { tr, formatNumber } = useAdminLocale();
  const [pages, setPages] = useState<PageSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [statusFilter, setStatusFilter] = useState(filterStatus || "all");
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [sortBy, setSortBy] = useState<PageSortBy>("updatedAt");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [processing, setProcessing] = useState(false);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const requestSequence = useRef(0);

  useEffect(() => {
    setStatusFilter(filterStatus || "all");
    setPage(0);
  }, [filterStatus]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(searchQuery.trim());
      setPage(0);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [page, pageSize, statusFilter, debouncedSearch]);

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
    } catch (err: unknown) {
      if (requestId !== requestSequence.current) return;
      setError(err instanceof Error ? err.message : tr("Failed to fetch pages"));
    } finally {
      if (requestId === requestSequence.current) setLoading(false);
    }
  }, [page, pageSize, sortBy, sortOrder, statusFilter, debouncedSearch, tr]);

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
    const failed = results.filter((result) => result.status === "rejected").length;
    const succeeded = results.length - failed;
    setConfirmAction(null);
    setSelectedIds(new Set());
    setProcessing(false);
    setActionFeedback({
      type: failed ? "error" : "success",
      message: failed
        ? `${formatNumber(succeeded)} ${tr("completed")}, ${formatNumber(failed)} ${tr("failed")}. Refresh and retry the remaining items.`
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

  if (loading && pages.length === 0) {
    return (
      <div className="mx-auto w-full max-w-7xl animate-pulse space-y-6" aria-busy="true">
        <div className="flex items-center justify-between gap-4">
          <div className="h-8 w-36 rounded-md bg-muted" />
          <div className="h-11 w-32 rounded-md bg-muted" />
        </div>
        <div className="rounded-xl border border-border/70 bg-card p-4">
          {[1, 2, 3, 4].map((item) => <div key={item} className="mb-3 h-14 rounded-lg bg-muted/40 last:mb-0" />)}
        </div>
      </div>
    );
  }

  if (error && pages.length === 0) {
    return (
      <div className="mx-auto w-full max-w-7xl space-y-3 rounded-xl border border-destructive/20 bg-card p-6">
        <div className="flex items-center gap-2 text-sm font-semibold text-destructive">
          <AlertCircle className="size-4" aria-hidden="true" />
          {tr("Unable to load static pages")}
        </div>
        <p className="text-sm text-muted-foreground">{error}</p>
        <Button variant="outline" onClick={() => void fetchPages()} className="min-h-11 gap-2">
          <RefreshCw className="size-4" aria-hidden="true" /> {tr("Try again")}
        </Button>
      </div>
    );
  }

  const actionTitle = confirmAction?.kind === "delete"
    ? tr("Delete selected content?")
    : confirmAction?.kind === "publish"
      ? tr("Publish selected content?")
      : tr("Unpublish selected content?");
  const actionDescription = confirmAction
    ? `${tr("You are about to")} ${confirmAction.kind === "delete" ? tr("delete") : confirmAction.kind === "publish" ? tr("publish") : tr("unpublish")} ${formatNumber(confirmAction.ids.length)} ${tr("items on this page")}.`
    : "";

  return (
    <div className="mx-auto w-full max-w-6xl min-w-0 space-y-6">
      <AdminPageHeader
        title={tr("Static Pages")}
        description={tr("Manage standalone site pages, legal policies, and landing documents.")}
        actions={canCreate ? (
          <Button onClick={() => onNavigate("/admin/pages/new")} className="min-h-11 gap-2 self-start text-sm sm:self-auto">
            <Plus className="size-4" aria-hidden="true" /> {tr("Create Page")}
          </Button>
        ) : undefined}
      />

      {actionFeedback && (
        <div role={actionFeedback.type === "error" ? "alert" : "status"} className={actionFeedback.type === "error" ? "flex items-start justify-between gap-3 rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive" : "flex items-start justify-between gap-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300"}>
          <p className="min-w-0">{actionFeedback.message}</p>
          <button type="button" onClick={() => setActionFeedback(null)} className="inline-flex size-8 shrink-0 items-center justify-center rounded-md hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring" aria-label={tr("Dismiss")}>
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      )}

      <section className="vibress-editorial-filterbar space-y-4 pb-4 pt-1" aria-label={tr("Content filters")}>
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div role="group" aria-label={tr("Filter by status")} className="flex min-h-11 max-w-full items-center gap-1 overflow-x-auto">
              {STATUS_FILTERS.map((status) => (
                <button
                  key={status.value}
                  type="button"
                  onClick={() => { setStatusFilter(status.value); setPage(0); }}
                  aria-pressed={statusFilter === status.value}
                  className={statusFilter === status.value
                    ? "min-h-11 shrink-0 rounded-lg bg-muted px-3.5 text-sm font-semibold text-foreground"
                    : "min-h-11 shrink-0 rounded-lg px-3.5 text-sm font-medium text-muted-foreground hover:bg-muted/60 hover:text-foreground cursor-pointer"}
                >
                  {tr(status.label)}
                </button>
              ))}
            </div>

            <div className="flex min-w-0 flex-wrap items-center gap-2.5">
              <div className="relative min-w-0 flex-1 sm:w-64 sm:flex-none">
                <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input
                  type="search"
                  placeholder={tr("Search pages by title or slug...")}
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  aria-label={tr("Search pages by title or slug...")}
                  className="min-h-11 w-full rounded-lg border-border/80 bg-card ps-9 text-sm"
                />
              </div>
              <label className="flex min-h-10 items-center gap-2 text-xs text-muted-foreground">
                <span className="shrink-0">{tr("Sort by")}</span>
                <select
                  value={sortBy}
                  onChange={(event) => { setSortBy(event.target.value as PageSortBy); setPage(0); }}
                  className="min-h-11 min-w-0 rounded-lg border border-border/80 bg-card px-2.5 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-ring cursor-pointer sm:w-40"
                  aria-label={tr("Sort by")}
                >
                  <option value="updatedAt">{tr("Recently updated")}</option>
                  <option value="createdAt">{tr("Newest created")}</option>
                  <option value="publishedAt">{tr("Publication date")}</option>
                  <option value="title">{tr("Title")}</option>
                </select>
              </label>
              <Button type="button" variant="outline" size="sm" className="min-h-10 shrink-0" onClick={() => setSortOrder((order) => order === "desc" ? "asc" : "desc")} aria-label={tr("Toggle sort direction")}>
                {sortOrder === "desc" ? tr("Descending") : tr("Ascending")}
              </Button>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-3">
          <label className="inline-flex min-h-10 items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={allVisibleSelected}
              disabled={!selectionEnabled || pages.length === 0}
              onChange={(event) => setSelectedIds(event.target.checked ? new Set(visibleIds) : new Set())}
              className="size-4 accent-primary"
              aria-label={tr("Select all on this page")}
            />
            {tr("Select all on this page")}
          </label>
          <span className="text-sm text-muted-foreground">{tr("Showing")} {formatNumber(total)} {tr("pages")}</span>
        </div>
        {selectedIds.size > 0 && (
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
        {loading && pages.length > 0 && <div className="h-0.5 w-full overflow-hidden bg-muted"><div className="h-full w-1/3 animate-pulse bg-primary" /></div>}
        {error && pages.length > 0 && <p role="alert" className="border-b border-destructive/20 bg-destructive/5 px-4 py-2 text-sm text-destructive">{error}</p>}
        {pages.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 px-4 py-16 text-center text-muted-foreground">
            <FileCode className="size-9 opacity-40" aria-hidden="true" />
            <p className="font-medium text-foreground">{tr("No pages found")}</p>
            <p className="max-w-md text-sm">{tr("Try a different search or filter.")}</p>
            {!debouncedSearch && statusFilter === "all" && canCreate && (
              <Button size="sm" onClick={() => onNavigate("/admin/pages/new")} className="min-h-11 gap-2">
                <Plus className="size-4" aria-hidden="true" /> {tr("Create Page")}
              </Button>
            )}
          </div>
        ) : (
          <div role="list" aria-label={tr("Pages")} className="divide-y divide-border/60">
            {pages.map((item) => (
              <EditorialListRow
                key={item.id}
                title={item.title}
                authorName={item.authors?.[0]?.name}
                date={item.status === "published" && item.publishedAt ? item.publishedAt : item.updatedAt}
                status={item.status}
                onEdit={canEdit ? () => onNavigate(`/admin/pages/${item.id}`) : undefined}
                onStatistics={canViewAnalytics && item.status === "published" ? () => onNavigate("/admin") : undefined}
                onPublishToggle={canPublish ? () => void handlePublishToggle(item) : undefined}
                onDelete={canDelete ? () => requestDelete(item.id) : undefined}
                onSelect={selectionEnabled ? (selected) => toggleSelection(item.id, selected) : undefined}
                selected={selectedIds.has(item.id)}
                selectionLabel={`${tr("Select")}: ${item.title || tr("(Untitled)")}`}
              />
            ))}
          </div>
        )}
      </section>

      <EditorialPagination
        page={page}
        pageSize={pageSize}
        total={total}
        onPageChange={setPage}
        onPageSizeChange={(size) => { setPageSize(size); setPage(0); }}
      />

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
