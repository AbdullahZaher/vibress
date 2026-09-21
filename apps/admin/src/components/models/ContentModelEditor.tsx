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
  Database,
  ArrowUp,
  ArrowDown,
  Layers,
  Sparkles,
} from "lucide-react";
import { apiRequest } from "../../lib/api/client";
import { Button } from "../ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "../ui/card";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { Switch } from "../ui/switch";
import { Alert, AlertTitle, AlertDescription } from "../ui/alert";
import { EmptyState } from "../ui/empty-state";
import { Spinner } from "../ui/spinner";

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

  const handleMoveField = (index: number, direction: "up" | "down") => {
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= fields.length) return;
    const copy = [...fields];
    const temp = copy[index]!;
    copy[index] = copy[targetIndex]!;
    copy[targetIndex] = temp;
    setFields(copy);
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
      <div className="flex flex-col items-center justify-center py-24 text-muted-foreground gap-3">
        <Spinner size="md" />
        <span className="text-xs sm:text-sm font-medium">Loading model schema...</span>
      </div>
    );
  }

  return (
    <form onSubmit={handleSave} className="space-y-6 w-full max-w-5xl mx-auto">
      {/* Page Header & Navigation Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onNavigate("/admin/models")}
            className="gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            title="Back to Content Models"
          >
            <ArrowLeft className="h-4 w-4 rtl:rotate-180" />
            <span className="hidden sm:inline">Back to Models</span>
          </Button>

          <div className="h-4 w-[1px] bg-border hidden sm:block" />

          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-muted text-muted-foreground border border-border/60">
                MODEL
              </span>
              <h1 className="text-lg sm:text-xl font-bold tracking-tight text-foreground">
                {isEditing ? `Edit Model: ${name}` : "Create Content Model"}
              </h1>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {isEditing
                ? `Configure schema, validation rules, and API endpoints for ${slug}`
                : "Define field types, schema rules, and relationship mappings."}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-end sm:self-auto">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onNavigate("/admin/models")}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={saving}
            loading={saving}
            className="gap-2"
          >
            <Save className="h-4 w-4" />
            {saving ? "Saving..." : "Save Model"}
          </Button>
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Schema Evolution Warnings */}
      {evolutionWarnings.length > 0 && (
        <Alert variant="warning">
          <AlertTitle className="flex items-center gap-1.5 text-xs sm:text-sm font-semibold">
            <AlertTriangle className="h-4 w-4" />
            Schema Evolution Warnings
          </AlertTitle>
          <AlertDescription className="mt-2 space-y-1">
            {evolutionWarnings.map((w, idx) => (
              <p key={idx} className="text-xs">
                • {w}
              </p>
            ))}
          </AlertDescription>
        </Alert>
      )}

      {/* Basic Model Info Card */}
      <Card className="shadow-2xs">
        <CardHeader className="p-5 pb-4 border-b border-border/50">
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 text-primary" />
            <CardTitle className="text-sm font-semibold tracking-tight text-foreground uppercase">
              Model Details
            </CardTitle>
          </div>
          <CardDescription className="text-xs text-muted-foreground">
            Core metadata used for administrative identification and API routing.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-foreground">
                Model Name <span className="text-destructive">*</span>
              </label>
              <Input
                type="text"
                required
                value={name}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder="e.g. Portfolio Project"
                className="h-9"
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-foreground">
                API Slug <span className="text-destructive">*</span>
              </label>
              <Input
                type="text"
                required
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="e.g. portfolio-projects"
                className="h-9 font-mono text-xs"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-foreground">
              Description
            </label>
            <Textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description of this content structure..."
              className="min-h-[70px] text-xs sm:text-sm"
            />
          </div>
        </CardContent>
      </Card>

      {/* Visual Fields Builder */}
      <Card className="shadow-2xs">
        <CardHeader className="p-5 pb-4 border-b border-border/50 flex flex-row items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-primary" />
              <CardTitle className="text-sm font-semibold tracking-tight text-foreground uppercase">
                Fields Schema ({fields.length})
              </CardTitle>
            </div>
            <CardDescription className="text-xs text-muted-foreground mt-0.5">
              Add and configure data attributes for entries of this model.
            </CardDescription>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleAddField}
            className="gap-1.5 text-xs shrink-0"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Field
          </Button>
        </CardHeader>

        <CardContent className="p-5">
          {fields.length === 0 ? (
            <EmptyState
              icon={<Sparkles className="h-5 w-5 text-primary" />}
              title="No Fields Defined Yet"
              description="Click 'Add Field' above to build your structured content schema."
              className="p-8 sm:p-10"
            />
          ) : (
            <div className="space-y-3.5">
              {fields.map((field, idx) => (
                <div
                  key={field.id || idx}
                  className="rounded-xl border border-border/70 bg-card p-4 space-y-3.5 shadow-2xs hover:border-border transition-colors"
                >
                  {/* Field Header / Main Row */}
                  <div className="flex items-start sm:items-center gap-2.5">
                    {/* Move and Drag Order Controls */}
                    <div className="flex items-center gap-0.5 shrink-0 pt-1 sm:pt-0">
                      <div className="flex flex-col gap-0.5">
                        <button
                          type="button"
                          disabled={idx === 0}
                          onClick={() => handleMoveField(idx, "up")}
                          className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-20 cursor-pointer"
                          title="Move field up"
                          aria-label={`Move ${field.name} up`}
                        >
                          <ArrowUp className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          disabled={idx === fields.length - 1}
                          onClick={() => handleMoveField(idx, "down")}
                          className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-20 cursor-pointer"
                          title="Move field down"
                          aria-label={`Move ${field.name} down`}
                        >
                          <ArrowDown className="h-3 w-3" />
                        </button>
                      </div>
                      <GripVertical className="h-4 w-4 text-muted-foreground/40 cursor-grab shrink-0" />
                      <span className="text-[10px] font-mono text-muted-foreground/60 w-4 text-center">
                        #{idx + 1}
                      </span>
                    </div>

                    {/* Inputs Grid */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 flex-1 min-w-0">
                      <div className="space-y-1">
                        <label className="block text-[11px] font-medium text-muted-foreground">
                          Field Label
                        </label>
                        <Input
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
                          className="h-8 text-xs bg-background"
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="block text-[11px] font-medium text-muted-foreground">
                          Field Key (API identifier)
                        </label>
                        <Input
                          type="text"
                          required
                          value={field.key}
                          onChange={(e) => handleUpdateField(idx, { key: e.target.value })}
                          className="h-8 font-mono text-xs bg-background"
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="block text-[11px] font-medium text-muted-foreground">
                          Field Type
                        </label>
                        <select
                          value={field.type}
                          onChange={(e) => handleUpdateField(idx, { type: e.target.value })}
                          className="h-8 w-full rounded-md border border-border/70 bg-background px-2.5 text-xs text-foreground shadow-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors cursor-pointer"
                        >
                          {FIELD_TYPES.map((t) => (
                            <option key={t.value} value={t.value}>
                              {t.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* Delete Field Button */}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => handleRemoveField(idx)}
                      className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 shrink-0 mt-4 sm:mt-0"
                      title="Remove Field"
                      aria-label={`Remove field ${field.name}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>

                  {/* Sub-configuration for Relation Fields */}
                  {(field.type === "relation" || field.type === "relation_list") && (
                    <div className="p-3 rounded-lg border border-primary/20 bg-primary/5 dark:bg-primary/10 text-xs flex flex-col sm:flex-row sm:items-center gap-2">
                      <div className="flex items-center gap-1.5 font-medium text-foreground">
                        <LinkIcon className="h-3.5 w-3.5 text-primary" />
                        <span>Target Related Model:</span>
                      </div>
                      <select
                        value={field.relationModel || ""}
                        onChange={(e) => handleUpdateField(idx, { relationModel: e.target.value })}
                        className="h-8 flex-1 max-w-xs rounded-md border border-border/70 bg-background px-2.5 text-xs text-foreground focus-visible:ring-2 focus-visible:ring-ring cursor-pointer"
                      >
                        <option value="">-- Select Target Model --</option>
                        {availableModels.map((m) => (
                          <option key={m.id} value={m.slug}>
                            {m.name} ({m.slug})
                          </option>
                        ))}
                      </select>
                      {field.type === "relation_list" && (
                        <span className="text-[11px] text-muted-foreground font-medium ms-auto">
                          Supports multi-selection &amp; ordering (max 100)
                        </span>
                      )}
                    </div>
                  )}

                  {/* Sub-configuration for Select / Multi-Select */}
                  {(field.type === "select" || field.type === "multi_select") && (
                    <div className="p-3 rounded-lg border border-border/60 bg-muted/20 text-xs space-y-1.5">
                      <label className="block font-medium text-foreground">
                        Options (comma-separated Label:Value or Value):
                      </label>
                      <Input
                        type="text"
                        value={field.optionsRaw || ""}
                        onChange={(e) => handleUpdateField(idx, { optionsRaw: e.target.value })}
                        placeholder="e.g. In Stock:in_stock, Out of Stock:out_of_stock"
                        className="h-8 text-xs bg-background"
                      />
                    </div>
                  )}

                  {/* Field Flags Toolbar */}
                  <div className="flex flex-wrap items-center justify-between gap-4 pt-2 border-t border-border/50 text-xs">
                    <div className="flex items-center gap-5">
                      <label className="inline-flex items-center gap-2 cursor-pointer text-foreground select-none">
                        <Switch
                          checked={field.required}
                          onCheckedChange={(checked) => handleUpdateField(idx, { required: checked })}
                        />
                        <span className="font-medium">Required</span>
                      </label>

                      <label className="inline-flex items-center gap-2 cursor-pointer text-foreground select-none">
                        <Switch
                          checked={field.localizable}
                          onCheckedChange={(checked) => handleUpdateField(idx, { localizable: checked })}
                        />
                        <span className="inline-flex items-center gap-1 font-medium">
                          <Globe className="h-3 w-3 text-muted-foreground" />
                          Localizable (i18n)
                        </span>
                      </label>
                    </div>

                    <div className="inline-flex items-center gap-1.5 text-muted-foreground ms-auto">
                      <Eye className="h-3.5 w-3.5 text-muted-foreground/70" />
                      <span className="font-medium text-[11px]">API Visibility:</span>
                      <select
                        value={field.apiVisibility || "public"}
                        onChange={(e) =>
                          handleUpdateField(idx, {
                            apiVisibility: e.target.value as "public" | "authenticated" | "private",
                          })
                        }
                        className="h-7 rounded-md border border-border/70 bg-background px-2 text-[11px] font-medium text-foreground shadow-2xs focus-visible:ring-2 focus-visible:ring-ring cursor-pointer"
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
        </CardContent>
      </Card>
    </form>
  );
}
