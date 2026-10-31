import { useState, useEffect } from "react";
import { useAdminLocale } from "../../lib/admin-locale";
import { Plus, Edit, Trash2, ArrowLeft, Layers } from "lucide-react";
import { apiRequest } from "../../lib/api";
import { AdminPageHeader } from "../common/AdminPageHeader";
import { Dialog } from "../ui/dialog";
import { Button } from "../ui/button";

export interface CollectionEntryItem {
  id: string;
  title: string;
  slug: string;
  status: "draft" | "published" | "archived";
  createdAt: string;
  updatedAt: string;
}

export function DynamicCollectionList({
  modelSlug,
  onNavigate,
  canEdit = false,
}: {
  modelSlug: string;
  onNavigate: (path: string) => void;
  canEdit?: boolean;
}) {
  const { tr, locale } = useAdminLocale();
  const [entries, setEntries] = useState<CollectionEntryItem[]>([]);
  const [modelName, setModelName] = useState(modelSlug);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; title: string } | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [page, setPage] = useState(0);
  const [hasNext, setHasNext] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | "draft" | "published" | "archived">("");
  const [sortBy, setSortBy] = useState<"createdAt" | "updatedAt" | "title">("createdAt");
  const pageSize = 50;

  useEffect(() => {
    const handle = setTimeout(() => {
      setPage(0);
      setSearch(searchInput.trim());
    }, 300);
    return () => clearTimeout(handle);
  }, [searchInput]);

  const fetchEntries = async () => {
    try {
      setError(null);
      setLoading(true);
      const modelRes = await apiRequest<{
        data?: { name: string };
        model?: { name: string };
      }>(`/content-models/${modelSlug}`).catch(() => ({ data: undefined, model: { name: modelSlug } }));
      setModelName(modelRes.data?.name || modelRes.model?.name || modelSlug);

      // Fetch collection entries
      const entriesRes = await apiRequest<{
        data?: CollectionEntryItem[];
        entries?: CollectionEntryItem[];
      }>(`/content-models/${modelSlug}/entries?${new URLSearchParams({
        limit: String(pageSize + 1),
        offset: String(page * pageSize),
        ...(search ? { search } : {}),
        ...(statusFilter ? { status: statusFilter } : {}),
        sortBy,
        sortOrder: "desc",
      }).toString()}`);
      const results = entriesRes.data || entriesRes.entries || [];
      setHasNext(results.length > pageSize);
      setEntries(results.slice(0, pageSize));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load collection entries");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchEntries();
  }, [modelSlug, page, search, statusFilter, sortBy]);

  const handleDelete = async () => {
    if (!pendingDelete || !canEdit || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await apiRequest(`/api/admin/v1/content-models/${modelSlug}/entries/${pendingDelete.id}`, { method: "DELETE" });
      setPendingDelete(null);
      await fetchEntries();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : tr("Failed to delete entry"));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <section className="mx-auto w-full max-w-7xl space-y-6">
      <AdminPageHeader
        backAction={
          <button
            type="button"
            aria-label={tr("Back to content models")}
            onClick={() => onNavigate("/admin/settings/advanced/content-models")}
            className="inline-flex size-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            <ArrowLeft className="w-5 h-5 rtl:rotate-180" />
          </button>
        }
        title={modelName}
        description={`Collection: /api/content/v1/collections/${modelSlug}`}
        actions={
          canEdit && (
            <button
              onClick={() => onNavigate(`/admin/collections/${modelSlug}/new`)}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-ring"
            >
              <Plus className="w-4 h-4" />
              {tr("New Entry")}
            </button>
          )
        }
      />

      <div className="flex flex-wrap gap-3 items-center" role="search" aria-label={tr("Filter collection entries")}>
        <input
          type="search"
          aria-label={tr("Search entries")}
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          placeholder={tr("Search collection entries...")}
          className="min-h-11 flex-1 min-w-44 rounded-lg border border-border bg-background px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-ring"
        />
        <select
          aria-label={tr("Filter publication status")}
          value={statusFilter}
          onChange={(event) => {
            setPage(0);
            setStatusFilter(event.target.value as "" | "draft" | "published" | "archived");
          }}
          className="min-h-11 rounded-lg border border-border bg-background px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-ring"
        >
          <option value="">{tr("All statuses")}</option>
          <option value="draft">{tr("Draft")}</option>
          <option value="published">{tr("Published")}</option>
          <option value="archived">{tr("Archived")}</option>
        </select>
        <select
          aria-label={tr("Sort entries")}
          value={sortBy}
          onChange={(event) => {
            setPage(0);
            setSortBy(event.target.value as "createdAt" | "updatedAt" | "title");
          }}
          className="min-h-11 rounded-lg border border-border bg-background px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-ring"
        >
          <option value="createdAt">{tr("Newest created")}</option>
          <option value="updatedAt">{tr("Recently updated")}</option>
          <option value="title">{tr("Title")}</option>
        </select>
      </div>

      {error && (
        <div role="alert" className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-xs text-destructive">
          {error}
        </div>
      )}

      {loading ? (
        <div role="status" className="flex items-center justify-center py-12 text-muted-foreground">
          <div className="me-2 h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          {tr("Loading collection entries...")}
        </div>
      ) : entries.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/70 bg-card p-8 py-12 text-center">
          <Layers className="w-12 h-12 text-muted-foreground/60 mx-auto mb-3" />
          <h3 className="text-base font-semibold text-foreground">
            {search || statusFilter ? tr("No matching entries") : tr("No Entries Yet")}
          </h3>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto mt-1 mb-4">
            {search || statusFilter ? tr("Adjust the search or filters to find other entries.") : tr("Create your first entry in this structured content collection.")}
          </p>
          {canEdit && <button
            onClick={() => onNavigate(`/admin/collections/${modelSlug}/new`)}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-ring"
          >
            <Plus className="w-4 h-4" />
            {tr("Create Entry")}
          </button>}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border/70 bg-card shadow-2xs">
          <table aria-label={tr("Collection entries")} className="w-full min-w-[650px] text-start text-sm">
            <thead className="border-b border-border/70 bg-muted/30 text-xs font-semibold text-muted-foreground">
              <tr>
                <th className="px-4 py-3">{tr("Title")}</th>
                <th className="px-4 py-3">{tr("Slug")}</th>
                <th className="px-4 py-3">{tr("Status")}</th>
                <th className="px-4 py-3">{tr("Last Updated")}</th>
                <th className="px-4 py-3 text-end">{tr("Actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {entries.map((entry) => (
                <tr key={entry.id} className="hover:bg-muted/40">
                  <td className="px-4 py-3 font-medium text-foreground">
                    {entry.title}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                    {entry.slug}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-md border px-2 py-1 text-xs font-medium ${
                        entry.status === "published"
                          ? "border-status-published-border bg-status-published-bg text-status-published-fg"
                          : "border-status-draft-border bg-status-draft-bg text-status-draft-fg"
                      }`}
                    >
                      {tr(entry.status.charAt(0).toUpperCase() + entry.status.slice(1))}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {new Date(entry.updatedAt).toLocaleDateString(locale)}
                  </td>
                  <td className="px-4 py-3 text-end">
                    <div className="inline-flex items-center gap-1">
                      {canEdit && <button
                        onClick={() => onNavigate(`/admin/collections/${modelSlug}/${entry.id}`)}
                        className="inline-flex size-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                        title={tr("Edit Entry")}
                        aria-label={`${tr("Edit Entry")}: ${entry.title}`}
                      >
                        <Edit className="w-4 h-4" />
                      </button>}
                      {canEdit && <button
                        onClick={() => { setDeleteError(null); setPendingDelete({ id: entry.id, title: entry.title }); }}
                        className="inline-flex size-10 items-center justify-center rounded-lg text-destructive hover:bg-destructive/10 focus-visible:outline-2 focus-visible:outline-ring"
                        title={tr("Delete Entry")}
                        aria-label={`${tr("Delete Entry")}: ${entry.title}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!loading && (page > 0 || hasNext) && (
        <nav aria-label={tr("Collection entries pages")} className="flex items-center justify-between pt-4">
          <button type="button" disabled={page === 0}
            onClick={() => setPage((current) => Math.max(0, current - 1))}
            className="min-h-11 rounded-lg border border-border/70 bg-card px-4 py-2 text-sm text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50">{tr("Previous")}</button>
          <span className="text-sm text-muted-foreground">{tr("Page")} {page + 1}</span>
          <button type="button" disabled={!hasNext}
            onClick={() => setPage((current) => current + 1)}
            className="min-h-11 rounded-lg border border-border/70 bg-card px-4 py-2 text-sm text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50">{tr("Next")}</button>
        </nav>
      )}
      <Dialog
        isOpen={pendingDelete !== null}
        onClose={() => { if (!deleting) { setPendingDelete(null); setDeleteError(null); } }}
        title={tr("Delete Entry")}
        description={tr("This action cannot be undone.")}
      >
        {pendingDelete && (
          <div className="space-y-5">
            <p dir="auto" className="break-words text-sm font-medium text-foreground">{pendingDelete.title}</p>
            {deleteError && (
              <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{deleteError}</p>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="outline" disabled={deleting} onClick={() => { setPendingDelete(null); setDeleteError(null); }}>
                {tr("Cancel")}
              </Button>
              <Button type="button" variant="destructive" disabled={deleting} onClick={() => void handleDelete()}>
                {deleting ? tr("Deleting...") : tr("Delete")}
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </section>
  );
}
