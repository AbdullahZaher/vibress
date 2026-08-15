import React, { useState, useEffect } from "react";
import { Plus, Trash2, ArrowLeft, Save, GripVertical } from "lucide-react";
import { apiRequest } from "../../lib/api";

export interface FieldItem {
  id: string;
  name: string;
  key: string;
  type: string;
  required: boolean;
  description?: string;
  options?: Array<{ label: string; value: string }>;
}

const FIELD_TYPES = [
  { value: "text", label: "Short Text" },
  { value: "rich_text", label: "Rich Text / Markdown" },
  { value: "number", label: "Number" },
  { value: "boolean", label: "Boolean / Switch" },
  { value: "date", label: "Date / Timestamp" },
  { value: "media", label: "Media / Asset" },
  { value: "relation", label: "Relation" },
  { value: "select", label: "Single Select Dropdown" },
  { value: "json", label: "Custom JSON" },
];

export function ContentModelEditor({
  modelId,
  onNavigate,
}: {
  modelId?: string | undefined;
  onNavigate: (path: string) => void;
}) {
  const isEditing = Boolean(modelId && modelId !== "new");
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [fields, setFields] = useState<FieldItem[]>([]);
  const [loading, setLoading] = useState(isEditing);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isEditing && modelId) {
      void (async () => {
        try {
          setLoading(true);
          const res = await apiRequest<{
            data?: {
              name: string;
              slug: string;
              description?: string;
              fields: FieldItem[];
            };
            model?: {
              name: string;
              slug: string;
              description?: string;
              fields: FieldItem[];
            };
          }>(`/content-models/${modelId}`);
          const m = res.data || res.model;
          if (m) {
            setName(m.name);
            setSlug(m.slug);
            setDescription(m.description || "");
            setFields(m.fields || []);
          }
        } catch (err) {
          setError(err instanceof Error ? err.message : "Failed to load model");
        } finally {
          setLoading(false);
        }
      })();
    }
  }, [isEditing, modelId]);

  const handleNameChange = (val: string) => {
    setName(val);
    if (!isEditing) {
      setSlug(
        val
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, ""),
      );
    }
  };

  const handleAddField = () => {
    const newField: FieldItem = {
      id: `field_${Date.now()}`,
      name: `Field ${fields.length + 1}`,
      key: `field_${fields.length + 1}`,
      type: "text",
      required: false,
    };
    setFields([...fields, newField]);
  };

  const handleUpdateField = (index: number, updates: Partial<FieldItem>) => {
    const updated = [...fields];
    const current = updated[index];
    if (current) {
      updated[index] = { ...current, ...updates };
      setFields(updated);
    }
  };

  const handleRemoveField = (index: number) => {
    setFields(fields.filter((_, i) => i !== index));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("Model name is required");
      return;
    }
    if (!slug.trim()) {
      setError("Model slug is required");
      return;
    }

    try {
      setSaving(true);
      setError(null);
      const payload = {
        name,
        slug,
        description: description || undefined,
        fields,
      };

      if (isEditing) {
        await apiRequest(`/api/admin/v1/content-models/${modelId}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
      } else {
        await apiRequest("/api/admin/v1/content-models", {
          method: "POST",
          body: JSON.stringify(payload),
        });
      }

      onNavigate("/admin/models");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save model");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-500">
        <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin mr-2" />
        Loading model schema...
      </div>
    );
  }

  return (
    <form onSubmit={handleSave} className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => onNavigate("/admin/models")}
            className="p-1.5 text-slate-500 hover:text-slate-900 dark:hover:text-white rounded hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">
            {isEditing ? `Edit Model: ${name}` : "Create Content Model"}
          </h1>
        </div>
        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-md text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
        >
          <Save className="w-4 h-4" />
          {saving ? "Saving..." : "Save Model"}
        </button>
      </div>

      {error && (
        <div className="p-4 bg-destructive/10 text-destructive rounded-md text-sm">
          {error}
        </div>
      )}

      {/* Basic Model Info */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-4">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white uppercase tracking-wider">
          Model Details
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Model Name *
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="e.g. Portfolio Project"
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-md bg-transparent text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              API Slug *
            </label>
            <input
              type="text"
              required
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="e.g. portfolio-projects"
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-md bg-transparent font-mono text-sm"
            />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
            Description
          </label>
          <textarea
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Brief description of this content structure..."
            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-md bg-transparent text-sm"
          />
        </div>
      </div>

      {/* Visual Fields Builder */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white uppercase tracking-wider">
            Fields Schema ({fields.length})
          </h2>
          <button
            type="button"
            onClick={handleAddField}
            className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded text-slate-800 dark:text-slate-200"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Field
          </button>
        </div>

        {fields.length === 0 ? (
          <div className="text-center py-8 border border-dashed border-slate-200 dark:border-slate-800 rounded-md text-sm text-slate-500">
            No fields defined yet. Click "Add Field" to build your schema.
          </div>
        ) : (
          <div className="space-y-3">
            {fields.map((field, idx) => (
              <div
                key={field.id || idx}
                className="p-4 border border-slate-200 dark:border-slate-800 rounded-md bg-slate-50 dark:bg-slate-950/50 space-y-3"
              >
                <div className="flex items-center gap-3">
                  <GripVertical className="w-4 h-4 text-slate-400 cursor-move" />
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 flex-1">
                    <div>
                      <label className="block text-[11px] font-medium text-slate-500 mb-1">
                        Field Label
                      </label>
                      <input
                        type="text"
                        required
                        value={field.name}
                        onChange={(e) => {
                          const n = e.target.value;
                          const k = n
                            .toLowerCase()
                            .replace(/[^a-z0-9]+/g, "_")
                            .replace(/^_+|_+$/g, "");
                          handleUpdateField(idx, { name: n, key: field.key || k });
                        }}
                        className="w-full px-2.5 py-1.5 border border-slate-300 dark:border-slate-700 rounded bg-white dark:bg-slate-900 text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-500 mb-1">
                        Field Key (API identifier)
                      </label>
                      <input
                        type="text"
                        required
                        value={field.key}
                        onChange={(e) => handleUpdateField(idx, { key: e.target.value })}
                        className="w-full px-2.5 py-1.5 border border-slate-300 dark:border-slate-700 rounded bg-white dark:bg-slate-900 font-mono text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-500 mb-1">
                        Field Type
                      </label>
                      <select
                        value={field.type}
                        onChange={(e) => handleUpdateField(idx, { type: e.target.value })}
                        className="w-full px-2.5 py-1.5 border border-slate-300 dark:border-slate-700 rounded bg-white dark:bg-slate-900 text-xs"
                      >
                        {FIELD_TYPES.map((t) => (
                          <option key={t.value} value={t.value}>
                            {t.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemoveField(idx)}
                    className="p-1.5 text-destructive/80 hover:text-destructive hover:bg-destructive/10 rounded"
                    title="Remove Field"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                <div className="flex items-center gap-6 pt-2 border-t border-slate-200 dark:border-slate-800 text-xs">
                  <label className="inline-flex items-center gap-2 cursor-pointer text-slate-700 dark:text-slate-300">
                    <input
                      type="checkbox"
                      checked={field.required}
                      onChange={(e) => handleUpdateField(idx, { required: e.target.checked })}
                      className="rounded border-slate-300 text-primary focus:ring-primary"
                    />
                    Required field
                  </label>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </form>
  );
}
