import React, { useState, useEffect } from "react";
import { ArrowLeft, Save } from "lucide-react";
import { apiRequest } from "../../lib/api";

export interface FieldDef {
  id: string;
  name: string;
  key: string;
  type: string;
  required?: boolean;
  description?: string;
  options?: Array<{ label: string; value: string | number }>;
}

export function DynamicCollectionEntryEditor({
  modelSlug,
  entryId,
  onNavigate,
}: {
  modelSlug: string;
  entryId?: string | undefined;
  onNavigate: (path: string) => void;
}) {
  const isEditing = Boolean(entryId && entryId !== "new");
  const [model, setModel] = useState<{ name: string; fields: FieldDef[] } | null>(null);
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [status, setStatus] = useState<"draft" | "published">("draft");
  const [formData, setFormData] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setLoading(true);
        // Load model schema
        const modelRes = await apiRequest<{
          data?: { name: string; fields: FieldDef[] };
          model?: { name: string; fields: FieldDef[] };
        }>(`/content-models/${modelSlug}`);
        setModel(modelRes.data || modelRes.model || null);

        // If editing, load entry
        if (isEditing && entryId) {
          const entryRes = await apiRequest<{
            data?: {
              title: string;
              slug: string;
              status: "draft" | "published";
              data: Record<string, unknown>;
            };
            entry?: {
              title: string;
              slug: string;
              status: "draft" | "published";
              data: Record<string, unknown>;
            };
          }>(`/content-models/${modelSlug}/entries/${entryId}`);
          const ent = entryRes.data || entryRes.entry;
          if (ent) {
            setTitle(ent.title);
            setSlug(ent.slug);
            setStatus(ent.status);
            setFormData(ent.data || {});
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load entry");
      } finally {
        setLoading(false);
      }
    })();
  }, [modelSlug, entryId, isEditing]);

  const handleTitleChange = (val: string) => {
    setTitle(val);
    if (!isEditing) {
      setSlug(
        val
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, ""),
      );
    }
  };

  const handleFieldChange = (key: string, value: unknown) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError("Title is required");
      return;
    }
    if (!slug.trim()) {
      setError("Slug is required");
      return;
    }

    try {
      setSaving(true);
      setError(null);
      const payload = {
        title,
        slug,
        status,
        data: formData,
      };

      if (isEditing) {
        await apiRequest(`/api/admin/v1/content-models/${modelSlug}/entries/${entryId}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
      } else {
        await apiRequest(`/api/admin/v1/content-models/${modelSlug}/entries`, {
          method: "POST",
          body: JSON.stringify(payload),
        });
      }

      onNavigate(`/admin/collections/${modelSlug}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save entry");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-500">
        <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin mr-2" />
        Loading entry...
      </div>
    );
  }

  return (
    <form onSubmit={handleSave} className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => onNavigate(`/admin/collections/${modelSlug}`)}
            className="p-1.5 text-slate-500 hover:text-slate-900 dark:hover:text-white rounded hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">
            {isEditing ? `Edit ${model?.name || "Entry"}: ${title}` : `New ${model?.name || "Entry"}`}
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as "draft" | "published")}
            className="px-3 py-1.5 border border-slate-300 dark:border-slate-700 rounded-md bg-transparent text-xs font-medium"
          >
            <option value="draft">Draft</option>
            <option value="published">Published</option>
          </select>
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-md text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            {saving ? "Saving..." : "Save Entry"}
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-destructive/10 text-destructive rounded-md text-sm">
          {error}
        </div>
      )}

      {/* Core Entry Identifiers */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Title *
            </label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => handleTitleChange(e.target.value)}
              placeholder="Entry Title"
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-md bg-transparent text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Slug *
            </label>
            <input
              type="text"
              required
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="entry-slug"
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-md bg-transparent font-mono text-sm"
            />
          </div>
        </div>
      </div>

      {/* Dynamic Fields Form Renderer */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-4">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white uppercase tracking-wider">
          Structured Data
        </h2>

        {model?.fields?.length === 0 ? (
          <p className="text-sm text-slate-500">This model has no custom fields defined.</p>
        ) : (
          <div className="space-y-4">
            {model?.fields?.map((field) => {
              const val = formData[field.key];

              if (field.type === "boolean") {
                return (
                  <label
                    key={field.id || field.key}
                    className="flex items-center gap-3 cursor-pointer text-sm font-medium text-slate-700 dark:text-slate-300"
                  >
                    <input
                      type="checkbox"
                      checked={Boolean(val)}
                      onChange={(e) => handleFieldChange(field.key, e.target.checked)}
                      className="rounded border-slate-300 text-primary focus:ring-primary h-4 w-4"
                    />
                    {field.name}
                  </label>
                );
              }

              if (field.type === "select") {
                return (
                  <div key={field.id || field.key}>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      {field.name} {field.required && "*"}
                    </label>
                    <select
                      required={field.required}
                      value={String(val || "")}
                      onChange={(e) => handleFieldChange(field.key, e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-md bg-transparent text-sm"
                    >
                      <option value="">-- Select option --</option>
                      {field.options?.map((opt) => (
                        <option key={String(opt.value)} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              }

              if (field.type === "rich_text") {
                return (
                  <div key={field.id || field.key}>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      {field.name} {field.required && "*"}
                    </label>
                    <textarea
                      rows={4}
                      required={field.required}
                      value={String(val || "")}
                      onChange={(e) => handleFieldChange(field.key, e.target.value)}
                      placeholder={`Enter ${field.name}...`}
                      className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-md bg-transparent text-sm"
                    />
                  </div>
                );
              }

              return (
                <div key={field.id || field.key}>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    {field.name} {field.required && "*"}
                  </label>
                  <input
                    type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"}
                    required={field.required}
                    value={val !== undefined && val !== null ? String(val) : ""}
                    onChange={(e) =>
                      handleFieldChange(
                        field.key,
                        field.type === "number" ? (e.target.value === "" ? "" : Number(e.target.value)) : e.target.value,
                      )
                    }
                    placeholder={`Enter ${field.name}...`}
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-md bg-transparent text-sm"
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </form>
  );
}
