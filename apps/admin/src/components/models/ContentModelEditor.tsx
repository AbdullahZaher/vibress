import React, { useState, useEffect } from "react";
import {
  Plus,
  Trash2,
  ArrowLeft,
  Save,
  GripVertical,
  ArrowUp,
  ArrowDown,
  Globe,
  Eye,
  AlertTriangle,
  Link as LinkIcon,
} from "lucide-react";
import { apiRequest } from "../../lib/api/client";
import { Button } from "../ui/button";

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
  { value: "short_text", label: "Short Text (Single Line)" },
  { value: "text", label: "Text / String" },
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
          .replace(/[^\p{L}\p{M}\p{N}]+/gu, "-")
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

  const handleMoveField = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= fields.length) return;
    setFields((current) => {
      const reordered = [...current];
      const moving = reordered[index];
      const adjacent = reordered[target];
      if (!moving || !adjacent) return current;
      reordered[index] = adjacent;
      reordered[target] = moving;
      return reordered;
    });
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
        // Preview schema changes before saving; do not silently ignore failures.
        {
          const previewRes = await apiRequest<{
            data?: { safe: boolean; warnings: string[] };
          }>(`/content-models/${modelId}/schema-evolution-preview`, {
            method: "POST",
            body: JSON.stringify({ fields: formattedFields }),
          });
          const preview = previewRes.data;
          if (!preview) {
            throw new Error("Unable to verify schema evolution safety.");
          }
          if (preview.warnings.length > 0) {
            setEvolutionWarnings(preview.warnings);
          }
          if (!preview.safe && !window.confirm(
            "This change may invalidate existing entries and will be blocked if entries exist. Continue?"
          )) {
            return;
          }
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

      onNavigate("/admin/settings/advanced/content-models");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save model");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        <div className="me-2 h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        Loading model schema...
      </div>
    );
  }

  return (
    <form onSubmit={handleSave} className="mx-auto w-full max-w-6xl space-y-6">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div className="flex min-w-0 items-center gap-3">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Back to content models"
            onClick={() => onNavigate("/admin/settings/advanced/content-models")}
            className="text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4 rtl:rotate-180" />
          </Button>
          <div className="min-w-0">
            <p className="mb-1 text-[11px] font-medium text-muted-foreground">
              Settings / Advanced / Content Models
            </p>
            <h1 className="break-words text-xl font-bold tracking-tight text-foreground sm:text-2xl">
              {isEditing ? `Edit Model: ${name}` : "Create Content Model"}
            </h1>
          </div>
        </div>
        <Button
          type="submit"
          size="sm"
          disabled={saving}
          className="self-start gap-1.5 sm:self-auto"
        >
          <Save className="w-4 h-4" />
          {saving ? "Saving..." : "Save Model"}
        </Button>
      </header>

      {error && (
        <div role="alert" className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-xs text-destructive">
          {error}
        </div>
      )}

      {evolutionWarnings.length > 0 && (
        <div role="status" className="space-y-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 text-xs text-amber-800 dark:text-amber-200">
          <div className="flex items-center gap-1.5 font-bold">
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            Schema Evolution Warnings:
          </div>
          {evolutionWarnings.map((w, idx) => (
            <p key={idx} className="ms-5">
              • {w}
            </p>
          ))}
        </div>
      )}

      {/* Basic Model Info */}
      <div className="space-y-4 rounded-xl border border-border/70 bg-card p-5 shadow-2xs">
        <h2 className="text-sm font-semibold tracking-tight text-foreground">
          Model Details
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="model-name" className="block text-xs font-medium text-foreground/85 mb-1">
              Model Name *
            </label>
            <input
              id="model-name"
              type="text"
              required
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="e.g. Portfolio Project"
              className="w-full px-3 py-2 border border-border/70 rounded-md bg-background text-sm text-foreground"
            />
          </div>
          <div>
            <label htmlFor="model-slug" className="block text-xs font-medium text-foreground/85 mb-1">
              API Slug *
            </label>
            <input
              id="model-slug"
              dir="ltr"
              type="text"
              required
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="e.g. portfolio-projects"
              className="w-full px-3 py-2 border border-border/70 rounded-md bg-background font-mono text-sm text-foreground"
            />
          </div>
        </div>
        <div>
          <label htmlFor="model-description" className="block text-xs font-medium text-foreground/85 mb-1">
            Description
          </label>
          <textarea
            id="model-description"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Brief description of this content structure..."
            className="w-full px-3 py-2 border border-border/70 rounded-md bg-background text-sm text-foreground"
          />
        </div>
      </div>

      {/* Visual Fields Builder */}
      <div className="space-y-4 rounded-xl border border-border/70 bg-card p-5 shadow-2xs">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold tracking-tight text-foreground">
            Fields Schema ({fields.length})
          </h2>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleAddField}
            className="gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Field
          </Button>
        </div>

        {fields.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/70 bg-muted/10 py-8 text-center text-xs text-muted-foreground">
            No fields defined yet. Click "Add Field" to build your schema.
          </div>
        ) : (
          <div className="space-y-4">
            {fields.map((field, idx) => (
              <div
                key={field.id || idx}
                className="space-y-3 rounded-lg border border-border/60 bg-muted/20 p-4"
              >
                <div className="flex flex-wrap items-start gap-3">
                  <div className="flex flex-col gap-1">
                    <Button type="button" variant="ghost" size="icon-sm" disabled={idx === 0}
                      onClick={() => handleMoveField(idx, -1)}
                      aria-label={`Move ${field.name} up`}
                      className="text-muted-foreground hover:text-foreground">
                      <ArrowUp className="w-3.5 h-3.5" />
                    </Button>
                    <GripVertical aria-hidden="true" className="w-4 h-4 text-muted-foreground" />
                    <Button type="button" variant="ghost" size="icon-sm" disabled={idx === fields.length - 1}
                      onClick={() => handleMoveField(idx, 1)}
                      aria-label={`Move ${field.name} down`}
                      className="text-muted-foreground hover:text-foreground">
                      <ArrowDown className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                  <div className="grid min-w-0 flex-1 grid-cols-1 gap-3 md:grid-cols-3">
                    <div>
                      <label htmlFor={`model-field-label-${idx}`} className="block text-[11px] font-medium text-muted-foreground mb-1">
                        Field Label
                      </label>
                      <input
                        id={`model-field-label-${idx}`}
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
                        className="w-full px-2.5 py-1.5 border border-border/70 rounded-md bg-card text-xs"
                      />
                    </div>
                    <div>
                      <label htmlFor={`model-field-key-${idx}`} className="block text-[11px] font-medium text-muted-foreground mb-1">
                        Field Key (API identifier)
                      </label>
                      <input
                        id={`model-field-key-${idx}`}
                        dir="ltr"
                        type="text"
                        required
                        value={field.key}
                        onChange={(e) => handleUpdateField(idx, { key: e.target.value })}
                        className="w-full px-2.5 py-1.5 border border-border/70 rounded-md bg-card font-mono text-xs"
                      />
                    </div>
                    <div>
                      <label htmlFor={`model-field-type-${idx}`} className="block text-[11px] font-medium text-muted-foreground mb-1">
                        Field Type
                      </label>
                      <select
                        id={`model-field-type-${idx}`}
                        value={field.type}
                        onChange={(e) => handleUpdateField(idx, { type: e.target.value })}
                        className="w-full px-2.5 py-1.5 border border-border/70 rounded-md bg-card text-xs"
                      >
                        {FIELD_TYPES.map((t) => (
                          <option key={t.value} value={t.value}>
                            {t.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => handleRemoveField(idx)}
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    aria-label={`Remove ${field.name}`}
                    title="Remove Field"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>

                {/* Conditional Sub-editors for specific field types */}
                {(field.type === "relation" || field.type === "relation_list") && (
                  <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-card/70 p-3 text-xs">
                    <LinkIcon className="w-3.5 h-3.5 text-primary" />
                    <span className="text-muted-foreground font-medium">
                      Target Related Model:
                    </span>
                    <select
                      value={field.relationModel || ""}
                      onChange={(e) => handleUpdateField(idx, { relationModel: e.target.value })}
                      aria-label={`Target model for ${field.name}`}
                      className="rounded-md border border-border/70 bg-background px-2 py-1 text-xs text-foreground"
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
                  <div className="space-y-2 rounded-lg border border-border/60 bg-card/70 p-3 text-xs">
                    <label className="block font-medium text-muted-foreground">
                      Options (comma-separated Label:Value or Value):
                    </label>
                    <input
                      type="text"
                      aria-label={`Options for ${field.name}`}
                      value={field.optionsRaw || ""}
                      onChange={(e) => handleUpdateField(idx, { optionsRaw: e.target.value })}
                      placeholder="e.g. In Stock:in_stock, Out of Stock:out_of_stock"
                      className="w-full px-2 py-1 border border-border/70 rounded bg-background text-xs text-foreground"
                    />
                  </div>
                )}

                {/* Field Flags & API Visibility */}
                <div className="flex flex-wrap items-center gap-4 border-t border-border/60 pt-3 text-xs">
                  <label className="inline-flex items-center gap-1.5 cursor-pointer text-foreground/85">
                    <input
                      type="checkbox"
                      checked={field.required}
                      onChange={(e) => handleUpdateField(idx, { required: e.target.checked })}
                      className="rounded border-slate-300 text-primary focus:ring-primary h-3.5 w-3.5"
                    />
                    Required
                  </label>

                  <label className="inline-flex items-center gap-1.5 cursor-pointer text-foreground/85">
                    <Globe className="w-3.5 h-3.5 text-muted-foreground" />
                    <input
                      type="checkbox"
                      checked={field.localizable}
                      onChange={(e) => handleUpdateField(idx, { localizable: e.target.checked })}
                      className="rounded border-slate-300 text-primary focus:ring-primary h-3.5 w-3.5"
                    />
                    Localizable (i18n)
                  </label>

                  <div className="inline-flex items-center gap-1.5 text-foreground/85 ms-auto">
                    <Eye className="w-3.5 h-3.5 text-muted-foreground" />
                    <span>API Visibility:</span>
                    <select
                      aria-label={`API visibility for ${field.name}`}
                      value={field.apiVisibility || "public"}
                      onChange={(e) =>
                        handleUpdateField(idx, {
                          apiVisibility: e.target.value as "public" | "authenticated" | "private",
                        })
                      }
                      className="px-2 py-0.5 border border-border/70 rounded-md bg-card text-xs"
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
