import React, { useState, useEffect } from "react";
import {
  Plus,
  Trash2,
  ArrowLeft,
  Save,
  GripVertical,
  Globe,
  Eye,
  AlertTriangle,
  Link as LinkIcon,
} from "lucide-react";
import { apiRequest } from "../../lib/api/client";

export interface FieldItem {
  id: string;
  name: string;
  key: string;
  type: string;
  required: boolean;
  description?: string;
  helpText?: string;
  localizable?: boolean;
  searchable?: boolean;
  filterable?: boolean;
  apiVisibility?: "public" | "authenticated" | "private";
  relationModel?: string;
  options?: Array<{ label: string; value: string | number }>;
  optionsRaw?: string; // For convenient options editing in UI
}

const FIELD_TYPES = [
  { value: "text", label: "Short Text" },
  { value: "long_text", label: "Long Text / Multi-line" },
  { value: "rich_text", label: "Rich Text / Markdown" },
  { value: "studio_doc", label: "Studio Document" },
  { value: "number", label: "Number / Decimal" },
  { value: "boolean", label: "Boolean / Switch" },
  { value: "date", label: "Date" },
  { value: "datetime", label: "Date & Time" },
  { value: "url", label: "URL Link" },
  { value: "email", label: "Email Address" },
  { value: "select", label: "Single Select Dropdown" },
  { value: "multi_select", label: "Multi Select List" },
  { value: "taxonomy", label: "Taxonomy / Tags" },
  { value: "relation", label: "Single Relation (1:1 / N:1)" },
  { value: "relation_list", label: "Multi Relation (1:N / M:N)" },
  { value: "media", label: "Media Asset / Image" },
  { value: "json", label: "Custom JSON Object" },
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
  const [availableModels, setAvailableModels] = useState<
    Array<{ id: string; name: string; slug: string }>
  >([]);
  const [loading, setLoading] = useState(isEditing);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [evolutionWarnings, setEvolutionWarnings] = useState<string[]>([]);

  useEffect(() => {
    void (async () => {
      try {
        // Fetch all models for relation target options
        const allRes = await apiRequest<{
          data?: Array<{ id: string; name: string; slug: string }>;
        }>("/content-models");
        if (allRes.data) {
          setAvailableModels(allRes.data);
        }

        if (isEditing && modelId) {
          setLoading(true);
          const res = await apiRequest<{
            data?: {
              id: string;
              name: string;
              slug: string;
              description?: string;
              fields: FieldItem[];
            };
            model?: {
              id: string;
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
            setFields(
              (m.fields || []).map((f) => ({
                ...f,
                optionsRaw: f.options
                  ? f.options.map((o) => `${o.label}:${o.value}`).join(", ")
                  : "",
              })),
            );
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load model");
      } finally {
        setLoading(false);
      }
    })();
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
      apiVisibility: "public",
      searchable: true,
      filterable: true,
      localizable: false,
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

  const parseOptionsRaw = (raw?: string): Array<{ label: string; value: string }> => {
    if (!raw || !raw.trim()) return [];
    return raw
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => {
        const parts = item.split(":");
        if (parts.length >= 2) {
          return { label: parts[0]!.trim(), value: parts.slice(1).join(":").trim() };
        }
        return { label: item, value: item.toLowerCase().replace(/\s+/g, "-") };
      });
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
      setEvolutionWarnings([]);

      const formattedFields = fields.map((f) => {
        const fieldCopy = { ...f };
        if (f.type === "select" || f.type === "multi_select") {
          fieldCopy.options = parseOptionsRaw(f.optionsRaw);
        }
        delete fieldCopy.optionsRaw;
        return fieldCopy;
      });

      const payload = {
        name: name.trim(),
        slug: slug.trim(),
        description: description || undefined,
        fields: formattedFields,
      };

      if (isEditing && modelId) {
        // Run evolution check first
        try {
          const previewRes = await apiRequest<{
            data?: { safe: boolean; warnings: string[] };
          }>(`/content-models/${modelId}/schema-evolution-preview`, {
            method: "POST",
            body: JSON.stringify({ fields: formattedFields }),
          });
          if (previewRes.data?.warnings && previewRes.data.warnings.length > 0) {
            setEvolutionWarnings(previewRes.data.warnings);
          }
        } catch {
          // Continue to save
        }

        await apiRequest(`/content-models/${modelId}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
      } else {
        await apiRequest("/content-models", {
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

      {evolutionWarnings.length > 0 && (
        <div className="p-4 bg-amber-500/10 border border-amber-500/20 text-amber-800 dark:text-amber-200 rounded-md text-xs space-y-1">
          <div className="flex items-center gap-1.5 font-bold">
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            Schema Evolution Warnings:
          </div>
          {evolutionWarnings.map((w, idx) => (
            <p key={idx} className="ml-5">
              • {w}
            </p>
          ))}
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
          <div className="space-y-4">
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

                {/* Conditional Sub-editors for specific field types */}
                {(field.type === "relation" || field.type === "relation_list") && (
                  <div className="bg-white dark:bg-slate-900 p-2.5 rounded border border-slate-200 dark:border-slate-800 text-xs flex items-center gap-2">
                    <LinkIcon className="w-3.5 h-3.5 text-primary" />
                    <span className="text-slate-600 dark:text-slate-400 font-medium">
                      Target Related Model:
                    </span>
                    <select
                      value={field.relationModel || ""}
                      onChange={(e) => handleUpdateField(idx, { relationModel: e.target.value })}
                      className="px-2 py-1 border border-slate-300 dark:border-slate-700 rounded bg-transparent text-xs"
                    >
                      <option value="">-- Select Target Model --</option>
                      {availableModels.map((m) => (
                        <option key={m.id} value={m.slug}>
                          {m.name} ({m.slug})
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {(field.type === "select" || field.type === "multi_select") && (
                  <div className="bg-white dark:bg-slate-900 p-2.5 rounded border border-slate-200 dark:border-slate-800 text-xs space-y-1">
                    <label className="block font-medium text-slate-600 dark:text-slate-400">
                      Options (comma-separated Label:Value or Value):
                    </label>
                    <input
                      type="text"
                      value={field.optionsRaw || ""}
                      onChange={(e) => handleUpdateField(idx, { optionsRaw: e.target.value })}
                      placeholder="e.g. In Stock:in_stock, Out of Stock:out_of_stock"
                      className="w-full px-2 py-1 border border-slate-300 dark:border-slate-700 rounded bg-transparent text-xs"
                    />
                  </div>
                )}

                {/* Field Flags & API Visibility */}
                <div className="flex flex-wrap items-center gap-5 pt-2 border-t border-slate-200 dark:border-slate-800 text-xs">
                  <label className="inline-flex items-center gap-1.5 cursor-pointer text-slate-700 dark:text-slate-300">
                    <input
                      type="checkbox"
                      checked={field.required}
                      onChange={(e) => handleUpdateField(idx, { required: e.target.checked })}
                      className="rounded border-slate-300 text-primary focus:ring-primary h-3.5 w-3.5"
                    />
                    Required
                  </label>

                  <label className="inline-flex items-center gap-1.5 cursor-pointer text-slate-700 dark:text-slate-300">
                    <Globe className="w-3.5 h-3.5 text-slate-400" />
                    <input
                      type="checkbox"
                      checked={field.localizable}
                      onChange={(e) => handleUpdateField(idx, { localizable: e.target.checked })}
                      className="rounded border-slate-300 text-primary focus:ring-primary h-3.5 w-3.5"
                    />
                    Localizable (i18n)
                  </label>

                  <div className="inline-flex items-center gap-1.5 text-slate-700 dark:text-slate-300 ml-auto">
                    <Eye className="w-3.5 h-3.5 text-slate-400" />
                    <span>API Visibility:</span>
                    <select
                      value={field.apiVisibility || "public"}
                      onChange={(e) =>
                        handleUpdateField(idx, {
                          apiVisibility: e.target.value as "public" | "authenticated" | "private",
                        })
                      }
                      className="px-2 py-0.5 border border-slate-300 dark:border-slate-700 rounded bg-white dark:bg-slate-900 text-xs"
                    >
                      <option value="public">Public (Default)</option>
                      <option value="authenticated">Authenticated Only</option>
                      <option value="private">Private / Staff Only</option>
                    </select>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </form>
  );
}
