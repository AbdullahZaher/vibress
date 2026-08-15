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
}: {
  modelSlug: string;
  onNavigate: (path: string) => void;
}) {
  const [entries, setEntries] = useState<CollectionEntryItem[]>([]);
  const [modelName, setModelName] = useState(modelSlug);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchEntries = async () => {
    try {
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
      }>(`/content-models/${modelSlug}/entries`);
      setEntries(entriesRes.data || entriesRes.entries || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load collection entries");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchEntries();
  }, [modelSlug]);

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
            onClick={() => onNavigate("/admin/models")}
            className="p-1.5 text-slate-500 hover:text-slate-900 dark:hover:text-white rounded hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Layers className="w-6 h-6 text-primary" />
              {modelName}
            </h1>
            <p className="text-xs text-slate-500 font-mono mt-0.5">
              Collection: /api/content/v1/collections/{modelSlug}
            </p>
          </div>
        </div>
        <button
          onClick={() => onNavigate(`/admin/collections/${modelSlug}/new`)}
          className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-md text-sm font-medium hover:bg-primary/90"
        >
          <Plus className="w-4 h-4" />
          New Entry
        </button>
      </div>

      {error && (
        <div className="p-4 bg-destructive/10 text-destructive rounded-md text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12 text-slate-500">
          <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin mr-2" />
          Loading collection entries...
        </div>
      ) : entries.length === 0 ? (
        <div className="text-center py-12 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-lg p-8">
          <Layers className="w-12 h-12 text-slate-400 mx-auto mb-3" />
          <h3 className="text-base font-semibold text-slate-800 dark:text-slate-200">
            No Entries Yet
          </h3>
          <p className="text-sm text-slate-500 max-w-sm mx-auto mt-1 mb-4">
            Create your first entry in this structured content collection.
          </p>
          <button
            onClick={() => onNavigate(`/admin/collections/${modelSlug}/new`)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-md text-sm font-medium hover:bg-primary/90"
          >
            <Plus className="w-4 h-4" />
            Create Entry
          </button>
        </div>
      ) : (
        <div className="border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden bg-white dark:bg-slate-900 shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800/50 text-xs font-semibold text-slate-500 uppercase border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="px-4 py-3">Title</th>
                <th className="px-4 py-3">Slug</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Last Updated</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {entries.map((entry) => (
                <tr key={entry.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">
                    {entry.title}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">
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
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {new Date(entry.updatedAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex items-center gap-1">
                      <button
                        onClick={() => onNavigate(`/admin/collections/${modelSlug}/${entry.id}`)}
                        className="p-1.5 text-slate-500 hover:text-slate-900 dark:hover:text-white rounded hover:bg-slate-100 dark:hover:bg-slate-800"
                        title="Edit Entry"
                      >
                        <Edit className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(entry.id, entry.title)}
                        className="p-1.5 text-destructive/80 hover:text-destructive rounded hover:bg-destructive/10"
                        title="Delete Entry"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
