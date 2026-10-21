import { useState, useEffect } from "react";
import { useAdminLocale } from "../../lib/admin-locale";
import { Plus, Edit, Trash2, ArrowLeft, Layers } from "lucide-react";
import { apiRequest } from "../../lib/api";
import { AdminPageHeader } from "../common/AdminPageHeader";

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

  const handleDelete = async (id: string, title: string) => {
    if (!confirm(`Are you sure you want to delete "${title}"?`)) return;
    try {
      await apiRequest(`/api/admin/v1/content-models/${modelSlug}/entries/${id}`, {
        method: "DELETE",
      });
      await fetchEntries();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete entry");
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
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground shadow-2xs hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
          className="rounded-md border border-border bg-background px-3 py-2 text-sm flex-1 min-w-44"
        />
        <select
          aria-label={tr("Filter publication status")}
          value={statusFilter}
          onChange={(event) => {
            setPage(0);
            setStatusFilter(event.target.value as "" | "draft" | "published" | "archived");
          }}
          className="rounded-md border border-border bg-background px-3 py-2 text-sm"
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
          className="rounded-md border border-border bg-background px-3 py-2 text-sm"
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
          Loading collection entries...
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
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground shadow-2xs hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                      className={`inline-flex px-2 py-0.5 text-[11px] font-medium uppercase rounded ${
                        entry.status === "published"
                          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                          : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
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
                        className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        title={tr("Edit Entry")}
                        aria-label={tr("Edit Entry")}
                      >
                        <Edit className="w-4 h-4" />
                      </button>}
                      {canEdit && <button
                        onClick={() => handleDelete(entry.id, entry.title)}
                        className="rounded-md p-1.5 text-destructive hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        title={tr("Delete Entry")}
                        aria-label={tr("Delete Entry")}
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
            className="rounded-md border border-border/70 bg-card px-3 py-1.5 text-xs text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">{tr("Previous")}</button>
          <span className="text-sm text-muted-foreground">{tr("Page")} {page + 1}</span>
          <button type="button" disabled={!hasNext}
            onClick={() => setPage((current) => current + 1)}
            className="rounded-md border border-border/70 bg-card px-3 py-1.5 text-xs text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">{tr("Next")}</button>
        </nav>
      )}
    </section>
  );
}
