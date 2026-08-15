import { useState, useEffect } from "react";
import { Plus, Database, Edit, Trash2, List } from "lucide-react";
import { apiRequest } from "../../lib/api";

export interface ContentModelItem {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  fields: Array<{ key: string; name: string; type: string; required?: boolean }>;
  createdAt: string;
}

export function ContentModelList({
  onNavigate,
}: {
  onNavigate: (path: string) => void;
}) {
  const [models, setModels] = useState<ContentModelItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchModels = async () => {
    try {
      setLoading(true);
      const res = await apiRequest<{ data?: ContentModelItem[]; models?: ContentModelItem[] }>(
        "/content-models",
      );
      setModels(res.data || res.models || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load content models");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchModels();
  }, []);

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Are you sure you want to delete model "${name}"? All entries will be removed.`)) {
      return;
    }
    try {
      await apiRequest(`/api/admin/v1/content-models/${id}`, { method: "DELETE" });
      await fetchModels();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete content model");
    }
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Database className="w-6 h-6 text-primary" />
            Content Modeler
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Design custom structured content models, validation schemas, and collection APIs.
          </p>
        </div>
        <button
          onClick={() => onNavigate("/admin/models/new")}
          className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-md text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Create Model
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
          Loading content models...
        </div>
      ) : models.length === 0 ? (
        <div className="text-center py-12 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-lg p-8">
          <Database className="w-12 h-12 text-slate-400 mx-auto mb-3" />
          <h3 className="text-base font-semibold text-slate-800 dark:text-slate-200">
            No Content Models Found
          </h3>
          <p className="text-sm text-slate-500 max-w-sm mx-auto mt-1 mb-4">
            Get started by creating your first structured content type for products, portfolios, courses, or events.
          </p>
          <button
            onClick={() => onNavigate("/admin/models/new")}
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-md text-sm font-medium hover:bg-primary/90"
          >
            <Plus className="w-4 h-4" />
            Create First Model
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {models.map((model) => (
            <div
              key={model.id}
              className="border border-slate-200 dark:border-slate-800 rounded-lg p-5 bg-white dark:bg-slate-900 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between"
            >
              <div>
                <div className="flex items-start justify-between">
                  <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
                    {model.name}
                  </h3>
                  <span className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 text-xs font-mono text-slate-600 dark:text-slate-400 rounded">
                    {model.slug}
                  </span>
                </div>
                {model.description && (
                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-2 line-clamp-2">
                    {model.description}
                  </p>
                )}
                <div className="mt-4 flex items-center gap-2">
                  <span className="text-xs text-slate-500 font-medium">
                    {model.fields?.length || 0} fields configured
                  </span>
                </div>
              </div>

              <div className="mt-6 pt-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
                <button
                  onClick={() => onNavigate(`/admin/collections/${model.slug}`)}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
                >
                  <List className="w-3.5 h-3.5" />
                  View Entries
                </button>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => onNavigate(`/admin/models/${model.id}`)}
                    className="p-1.5 text-slate-500 hover:text-slate-900 dark:hover:text-white rounded hover:bg-slate-100 dark:hover:bg-slate-800"
                    title="Edit Model Schema"
                  >
                    <Edit className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(model.id, model.name)}
                    className="p-1.5 text-destructive/80 hover:text-destructive rounded hover:bg-destructive/10"
                    title="Delete Model"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
