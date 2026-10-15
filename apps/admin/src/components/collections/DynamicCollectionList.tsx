import { useState, useEffect } from "react";
import { Plus, Edit, Trash2, ArrowLeft, Layers } from "lucide-react";
import { apiRequest } from "../../lib/api";

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
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => onNavigate("/admin/settings/advanced/content-models")}
            className="p-1.5 text-muted-foreground hover:text-slate-900 dark:hover:text-white rounded hover:bg-muted"
          >
            <ArrowLeft className="w-5 h-5 rtl:rotate-180" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Layers className="w-6 h-6 text-primary" />
              {modelName}
            </h1>
            <p className="text-xs text-muted-foreground font-mono mt-0.5">
              Collection: /api/content/v1/collections/{modelSlug}
            </p>
          </div>
        </div>
        {canEdit && <button
          onClick={() => onNavigate(`/admin/collections/${modelSlug}/new`)}
          className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-md text-sm font-medium hover:bg-primary/90"
        >
          <Plus className="w-4 h-4" />
          New Entry
        </button>}
      </div>

      <div className="flex flex-wrap gap-3 items-center" role="search" aria-label="Filter collection entries">
        <input
          type="search"
          aria-label="Search entries"
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          placeholder="Search collection entries..."
          className="rounded-md border border-border bg-background px-3 py-2 text-sm flex-1 min-w-44"
        />
        <select
          aria-label="Filter publication status"
          value={statusFilter}
          onChange={(event) => {
            setPage(0);
            setStatusFilter(event.target.value as "" | "draft" | "published" | "archived");
          }}
          className="rounded-md border border-border bg-background px-3 py-2 text-sm"
        >
          <option value="">All statuses</option>
          <option value="draft">Draft</option>
          <option value="published">Published</option>
          <option value="archived">Archived</option>
        </select>
        <select
          aria-label="Sort entries"
          value={sortBy}
          onChange={(event) => {
            setPage(0);
            setSortBy(event.target.value as "createdAt" | "updatedAt" | "title");
          }}
          className="rounded-md border border-border bg-background px-3 py-2 text-sm"
        >
          <option value="createdAt">Newest created</option>
          <option value="updatedAt">Recently updated</option>
          <option value="title">Title</option>
        </select>
      </div>

      {error && (
        <div className="p-4 bg-destructive/10 text-destructive rounded-md text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin mr-2" />
          Loading collection entries...
        </div>
      ) : entries.length === 0 ? (
        <div className="text-center py-12 border-2 border-dashed border-border/70 rounded-lg p-8">
          <Layers className="w-12 h-12 text-muted-foreground/60 mx-auto mb-3" />
          <h3 className="text-base font-semibold text-foreground">
            {search || statusFilter ? "No matching entries" : "No Entries Yet"}
          </h3>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto mt-1 mb-4">
            {search || statusFilter ? "Adjust the search or filters to find other entries." : "Create your first entry in this structured content collection."}
          </p>
          {canEdit && <button
            onClick={() => onNavigate(`/admin/collections/${modelSlug}/new`)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-md text-sm font-medium hover:bg-primary/90"
          >
            <Plus className="w-4 h-4" />
            Create Entry
          </button>}
        </div>
      ) : (
        <div className="border border-border/70 rounded-lg overflow-hidden bg-card shadow-sm">
          <table className="w-full text-start text-sm">
            <thead className="bg-muted/30 text-xs font-semibold text-muted-foreground uppercase border-b border-border/70">
              <tr>
                <th className="px-4 py-3">Title</th>
                <th className="px-4 py-3">Slug</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Last Updated</th>
                <th className="px-4 py-3 text-end">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {entries.map((entry) => (
                <tr key={entry.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
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
                      {entry.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {new Date(entry.updatedAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-end">
                    <div className="inline-flex items-center gap-1">
                      {canEdit && <button
                        onClick={() => onNavigate(`/admin/collections/${modelSlug}/${entry.id}`)}
                        className="p-1.5 text-muted-foreground hover:text-slate-900 dark:hover:text-white rounded hover:bg-muted"
                        title="Edit Entry"
                      >
                        <Edit className="w-4 h-4" />
                      </button>}
                      {canEdit && <button
                        onClick={() => handleDelete(entry.id, entry.title)}
                        className="p-1.5 text-destructive/80 hover:text-destructive rounded hover:bg-destructive/10"
                        title="Delete Entry"
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
        <nav aria-label="Collection entries pages" className="flex items-center justify-between pt-4">
          <button type="button" disabled={page === 0}
            onClick={() => setPage((current) => Math.max(0, current - 1))}
            className="px-3 py-2 border rounded disabled:opacity-50">Previous</button>
          <span className="text-sm text-muted-foreground">Page {page + 1}</span>
          <button type="button" disabled={!hasNext}
            onClick={() => setPage((current) => current + 1)}
            className="px-3 py-2 border rounded disabled:opacity-50">Next</button>
        </nav>
      )}
    </div>
  );
}
