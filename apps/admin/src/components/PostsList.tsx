import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAdminLocale } from "../lib/admin-locale";
import { apiRequest } from "../lib/api";
import { AdminPageHeader } from "./common/AdminPageHeader";
import { EditorialListRow } from "./common/EditorialListRow";
import { EditorialStatusFilter } from "./common/EditorialStatusFilter";
import { EditorialChoiceMenu } from "./common/EditorialChoiceMenu";
import { EditorialPagination } from "./common/EditorialPagination";
import { EditorialBulkActions } from "./common/EditorialBulkActions";
import { EditorialSelectionCheckbox } from "./common/EditorialSelectionCheckbox";
import { readEditorialViewState, saveEditorialViewState } from "./common/editorial-view-state";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Dialog } from "./ui/dialog";
import { Plus, Search, FileText, AlertCircle, RefreshCw, X, ArrowDownUp, CheckSquare2 } from "lucide-react";

interface PostSummary {
  id: string;
  title: string;
  slug: string;
  status: string;
  featured?: boolean;
  publishedAt: string | null;
  scheduledAt: string | null;
  updatedAt: string;
  authors?: Array<{ name: string; email: string }>;
  featureImage?: { url: string | null } | null;
}

type PostSortBy = "updatedAt" | "createdAt" | "publishedAt" | "title";
type BulkAction = "delete" | "publish" | "unpublish";
interface ConfirmAction {
  kind: BulkAction;
  ids: string[];
}

interface PostsListProps {
  onNavigate: (path: string) => void;
  canPublish: boolean;
  canViewAnalytics?: boolean;
  canCreate?: boolean;
  canEdit?: boolean;
  canDelete?: boolean;
  filterStatus?: string;
}

const STATUS_FILTERS = [
  { value: "all", label: "All Posts" },
  { value: "draft", label: "Drafts" },
  { value: "in_review", label: "In review" },
  { value: "changes_requested", label: "Changes requested" },
  { value: "scheduled", label: "Scheduled" },
  { value: "published", label: "Published" },
] as const;

export const PostsList: React.FC<PostsListProps> = ({
  onNavigate,
  canPublish,
  canCreate = false,
  canEdit = false,
  canDelete = false,
  filterStatus,
}) => {
  const { tr, formatNumber } = useAdminLocale();
  const [posts, setPosts] = useState<PostSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [resolvedQueryKey, setResolvedQueryKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [initialView] = useState(() => readEditorialViewState("posts", filterStatus || "all"));
  const [statusFilter, setStatusFilter] = useState(initialView.status);
  const [searchQuery, setSearchQuery] = useState(initialView.search);
  const [debouncedSearch, setDebouncedSearch] = useState(initialView.search);
  const [page, setPage] = useState(initialView.page);
  const [pageSize, setPageSize] = useState(initialView.pageSize);
  const [sortBy, setSortBy] = useState<PostSortBy>(initialView.sortBy);
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">(initialView.sortOrder);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [processing, setProcessing] = useState(false);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const requestSequence = useRef(0);

  useEffect(() => {
    saveEditorialViewState("posts", { status: statusFilter, search: debouncedSearch, page, pageSize, sortBy, sortOrder });
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
    setSelectionMode(false);
  }, [page, pageSize, statusFilter, debouncedSearch, sortBy, sortOrder]);

  const queryKey = JSON.stringify([page, pageSize, sortBy, sortOrder, statusFilter, debouncedSearch]);
  const fetchPosts = useCallback(async () => {
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
      const data = await apiRequest<{ posts: PostSummary[]; total: number }>(`/posts?${query.toString()}`);
      if (requestId !== requestSequence.current) return;
      setPosts(data.posts || []);
      setTotal(data.total || 0);
      setResolvedQueryKey(queryKey);
    } catch (err: unknown) {
      if (requestId !== requestSequence.current) return;
      setError(err instanceof Error ? err.message : tr("Failed to fetch posts"));
      setResolvedQueryKey(queryKey);
    } finally {
      if (requestId === requestSequence.current) setLoading(false);
    }
  }, [page, pageSize, sortBy, sortOrder, statusFilter, debouncedSearch, queryKey, tr]);

  useEffect(() => {
    void fetchPosts();
    return () => { requestSequence.current += 1; };
  }, [fetchPosts]);

  useEffect(() => {
    const lastPage = Math.max(0, Math.ceil(total / pageSize) - 1);
    if (page > lastPage) setPage(lastPage);
  }, [page, pageSize, total]);

  const visibleIds = useMemo(() => posts.map((post) => post.id), [posts]);
  const selectedPosts = useMemo(() => posts.filter((post) => selectedIds.has(post.id)), [posts, selectedIds]);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
  const someVisibleSelected = visibleIds.length > 0 && visibleIds.some((id) => selectedIds.has(id));
  const isIndeterminate = someVisibleSelected && !allVisibleSelected;
  const selectionEnabled = canDelete || canPublish;

  const toggleSelection = (id: string, selected: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (selected) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  };

  const handlePublishToggle = async (post: PostSummary) => {
    if (!canPublish || pendingIds.has(post.id)) return;
    setPendingIds((current) => new Set(current).add(post.id));
    setActionFeedback(null);
    try {
      const endpoint = post.status === "published"
        ? `/posts/${post.id}/unpublish`
        : `/posts/${post.id}/publish`;
      await apiRequest(endpoint, { method: "POST" });
      setActionFeedback({ type: "success", message: tr("Content status updated.") });
      await fetchPosts();
    } catch (err: unknown) {
      setActionFeedback({ type: "error", message: err instanceof Error ? err.message : tr("Action failed") });
    } finally {
      setPendingIds((current) => {
        const next = new Set(current);
        next.delete(post.id);
        return next;
      });
    }
  };

  const runConfirmedAction = async () => {
    if (!confirmAction || processing) return;
    const action = confirmAction;
    const targets = posts.filter((post) => action.ids.includes(post.id)).filter((post) => {
      if (action.kind === "publish") return post.status !== "published";
      if (action.kind === "unpublish") return post.status === "published";
      return true;
    });
    if (!targets.length) {
      setConfirmAction(null);
      return;
    }
    setProcessing(true);
    setActionFeedback(null);
    const results = await Promise.allSettled(targets.map((post) => {
      if (action.kind === "delete") return apiRequest(`/posts/${post.id}`, { method: "DELETE" });
      const endpoint = action.kind === "publish" ? `/posts/${post.id}/publish` : `/posts/${post.id}/unpublish`;
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
    await fetchPosts();
  };

  const requestDelete = (id: string) => setConfirmAction({ kind: "delete", ids: [id] });
  const requestBulkAction = (kind: BulkAction) => {
    const ids = selectedPosts
      .filter((post) => kind === "publish" ? post.status !== "published" : kind === "unpublish" ? post.status === "published" : true)
      .map((post) => post.id);
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
        title={tr("Posts")}
        actions={canCreate ? (
          <Button onClick={() => onNavigate("/admin/posts/new")} className="min-h-11 gap-2">
            <Plus className="size-4" aria-hidden="true" />{tr("New Post")}
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
              placeholder={tr("Search posts by title or slug...")}
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              aria-label={tr("Search posts by title or slug...")}
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
              setSortBy(field as PostSortBy);
              setSortOrder(order === "asc" ? "asc" : "desc");
              setPage(0);
            }}
            active={sortBy !== "updatedAt" || sortOrder !== "desc"}
            icon={<ArrowDownUp className="size-4" aria-hidden="true" />}
          />
          {selectionEnabled && (
            <Button
              type="button"
              variant={selectionMode ? "subtle" : "ghost"}
              size="sm"
              className="min-h-11 gap-2"
              aria-pressed={selectionMode}
              onClick={() => {
                setSelectionMode((active) => {
                  const next = !active;
                  if (!next) setSelectedIds(new Set());
                  return next;
                });
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
                {tr(STATUS_FILTERS.find(option => option.value === statusFilter)?.label || "All Posts")}
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
        {selectionMode && selectionEnabled && !resultsPending && !error && posts.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/50 pt-2">
            <EditorialSelectionCheckbox
              checked={allVisibleSelected}
              indeterminate={isIndeterminate}
              disabled={resultsPending || posts.length === 0}
              onChange={(next) => {
                setSelectedIds(next ? new Set(visibleIds) : new Set());
              }}
              label={tr("Select all on this page")}
              showLabel
              className="min-h-11 px-0"
            />
            <span aria-live="polite" className="text-sm text-muted-foreground">
              {resultsPending ? tr("Loading") : error ? tr("Results unavailable") : <>{tr("Showing")} {formatNumber(total)} {tr("posts")}</>}
            </span>
          </div>
        )}
        {!selectionMode && (
          <span aria-live="polite" className="sr-only">
            {resultsPending ? tr("Loading") : error ? tr("Results unavailable") : `${tr("Showing")} ${formatNumber(total)} ${tr("posts")}`}
          </span>
        )}
        {selectionMode && !resultsPending && !error && selectedIds.size > 0 && (
          <EditorialBulkActions
            selectedCount={selectedIds.size}
            showPublish={canPublish && selectedPosts.some((post) => post.status !== "published")}
            showUnpublish={canPublish && selectedPosts.some((post) => post.status === "published")}
            showDelete={canDelete}
            onAction={requestBulkAction}
            onClear={() => setSelectedIds(new Set())}
          />
        )}
      </section>

      <section className="vibress-editorial-list min-w-0 overflow-visible bg-card" aria-label={tr("Posts")}>
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
              {tr("Unable to load publication posts")}
            </div>
            <p className="max-w-xl break-words text-muted-foreground">{error}</p>
            <Button type="button" variant="outline" onClick={() => void fetchPosts()} className="min-h-11 gap-2">
              <RefreshCw className="size-4" aria-hidden="true" />{tr("Try again")}
            </Button>
          </div>
        ) : posts.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 px-4 py-16 text-center text-muted-foreground">
            <FileText className="size-9 opacity-40" aria-hidden="true" />
            <p className="font-medium text-foreground">{searchQuery || statusFilter !== "all" ? tr("No posts found") : tr("No posts yet")}</p>
            <p className="max-w-md text-sm">
              {searchQuery || statusFilter !== "all"
                ? tr("Try a different search or filter.")
                : tr("Create your first post to get started.")}
            </p>
            {(searchQuery || statusFilter !== "all") && (
              <Button type="button" size="sm" variant="outline" className="min-h-11" onClick={() => { setSearchQuery(""); setDebouncedSearch(""); setStatusFilter("all"); setPage(0); }}>
                {tr("Clear filters")}
              </Button>
            )}
          </div>
        ) : (
          <div role="list" aria-label={tr("Posts")} className="min-w-0">
            {posts.map((post) => (
              <EditorialListRow
                key={post.id}
                title={post.title}
                authorName={post.authors?.[0]?.name}
                date={post.status === "published" && post.publishedAt ? post.publishedAt : post.status === "scheduled" && post.scheduledAt ? post.scheduledAt : post.updatedAt}
                status={post.status}
                imageUrl={post.featureImage?.url}
                resource="post"
                featured={post.featured}
                onEdit={canEdit ? () => onNavigate(`/admin/posts/${post.id}`) : undefined}
                editHref={canEdit ? `/admin/posts/${post.id}` : undefined}
                onPublishToggle={canPublish ? () => void handlePublishToggle(post) : undefined}
                onDelete={canDelete ? () => requestDelete(post.id) : undefined}
                onSelect={selectionEnabled && selectionMode ? (selected) => toggleSelection(post.id, selected) : undefined}
                selectionMode={selectionMode}
                selected={selectionMode && selectedIds.has(post.id)}
                selectionLabel={`${tr("Select")}: ${post.title || tr("(Untitled)")}`}
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
