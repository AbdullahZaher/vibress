import React, { useState, useEffect } from "react";
import {
  ArrowLeft,
  Save,
  X,
  Image as ImageIcon,
  Link as LinkIcon,
  Globe,
  Code,
  CheckCircle2,
  FileText,
  ArrowUp,
  ArrowDown,
  Layers,
  Search,
} from "lucide-react";
import { apiRequest } from "../../lib/api/client";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "../ui/card";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { Switch } from "../ui/switch";
import { Checkbox } from "../ui/checkbox";
import { Alert, AlertDescription } from "../ui/alert";
import { Spinner } from "../ui/spinner";

export interface FieldDef {
  id: string;
  name: string;
  key: string;
  type: string;
  required?: boolean;
  description?: string;
  helpText?: string;
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  localizable?: boolean;
  options?: Array<{ label: string; value: string | number }>;
  relationModel?: string;
  defaultValue?: unknown;
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
  const [model, setModel] = useState<{ name: string; slug: string; fields: FieldDef[] } | null>(null);
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [status, setStatus] = useState<"draft" | "published" | "archived">("draft");
  const [formData, setFormData] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Localization active editor tab (for localizable fields)
  const [activeLocaleTab, setActiveLocaleTab] = useState<"en" | "ar">("en");

  // Relation available options cache { [relationModelSlugOrId]: Array<{ id: string; title: string; slug: string }> }
  const [relationOptions, setRelationOptions] = useState<
    Record<string, Array<{ id: string; title: string; slug: string }>>
  >({});

  // Search queries for relation lists
  const [relationSearchQuery, setRelationSearchQuery] = useState<Record<string, string>>({});

  useEffect(() => {
    void (async () => {
      try {
        setLoading(true);
        // Load model schema
        const modelRes = await apiRequest<{
          data?: { name: string; slug: string; fields: FieldDef[] };
          model?: { name: string; slug: string; fields: FieldDef[] };
        }>(`/content-models/${modelSlug}`);
        const loadedModel = modelRes.data || modelRes.model || null;
        setModel(loadedModel);

        if (loadedModel?.fields) {
          // Pre-fetch relation choices for relation and relation_list fields
          for (const field of loadedModel.fields) {
            if (
              (field.type === "relation" || field.type === "relation_list") &&
              field.relationModel
            ) {
              try {
                const relRes = await apiRequest<{
                  data?: Array<{ id: string; title: string; slug: string }>;
                }>(`/content-models/${field.relationModel}/entries?limit=100`);
                if (relRes.data) {
                  setRelationOptions((prev) => ({
                    ...prev,
                    [field.relationModel!]: relRes.data || [],
                  }));
                }
              } catch {
                // Ignore silent relation fetch failure
              }
            }
          }
        }

        // If editing, load entry
        if (isEditing && entryId) {
          const entryRes = await apiRequest<{
            data?: {
              title: string;
              slug: string;
              status: "draft" | "published" | "archived";
              data: Record<string, unknown>;
            };
            entry?: {
              title: string;
              slug: string;
              status: "draft" | "published" | "archived";
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

  const handleLocalizedFieldChange = (
    fieldKey: string,
    locale: string,
    value: unknown,
  ) => {
    setFormData((prev) => {
      const current = prev[fieldKey];
      let dict: Record<string, unknown> = {};
      if (typeof current === "object" && current !== null && !Array.isArray(current)) {
        dict = { ...(current as Record<string, unknown>) };
      } else if (typeof current === "string") {
        dict = { en: current };
      }
      dict[locale] = value;
      return { ...prev, [fieldKey]: dict };
    });
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
      setSuccess(null);
      const payload = {
        title: title.trim(),
        slug: slug.trim(),
        status,
        data: formData,
      };

      if (isEditing) {
        await apiRequest(`/content-models/${modelSlug}/entries/${entryId}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
      } else {
        await apiRequest(`/content-models/${modelSlug}/entries`, {
          method: "POST",
          body: JSON.stringify(payload),
        });
      }

      setSuccess("Entry saved successfully.");
      setTimeout(() => {
        onNavigate(`/admin/collections/${modelSlug}`);
      }, 500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save entry");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-muted-foreground gap-3">
        <Spinner size="md" />
        <span className="text-xs sm:text-sm font-medium">Loading entry editor...</span>
      </div>
    );
  }

  const hasLocalizableFields = model?.fields.some((f) => f.localizable);

  return (
    <form onSubmit={handleSave} className="space-y-6 w-full max-w-5xl mx-auto">
      {/* Editor Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onNavigate(`/admin/collections/${modelSlug}`)}
            className="gap-1.5 text-xs text-muted-foreground hover:text-foreground shrink-0"
            title={`Back to ${model?.name || modelSlug}`}
          >
            <ArrowLeft className="h-4 w-4 rtl:rotate-180" />
            <span className="hidden sm:inline">Back</span>
          </Button>

          <div className="h-4 w-[1px] bg-border hidden sm:block" />

          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-muted text-muted-foreground border border-border/60">
                ENTRY
              </span>
              <h1 className="text-lg sm:text-xl font-bold tracking-tight text-foreground">
                {isEditing ? `Edit ${model?.name || "Entry"}: ${title}` : `New ${model?.name || "Entry"}`}
              </h1>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5 font-mono">
              Collection: {modelSlug}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 self-end sm:self-auto">
          {/* Status Selector */}
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as "draft" | "published" | "archived")}
            className="h-9 px-3 text-xs font-semibold tracking-wide rounded-md border border-border/70 bg-card hover:border-border text-foreground uppercase cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring shadow-2xs transition-colors"
          >
            <option value="draft">Draft</option>
            <option value="published">Published</option>
            <option value="archived">Archived</option>
          </select>

          <Button
            type="submit"
            disabled={saving}
            loading={saving}
            className="gap-2"
          >
            <Save className="h-4 w-4" />
            {saving ? "Saving..." : "Save Entry"}
          </Button>
        </div>
      </div>

      {/* Global Notifications */}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {success && (
        <Alert variant="success">
          <AlertDescription className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>{success}</span>
          </AlertDescription>
        </Alert>
      )}

      {/* Core Identifiers Card */}
      <Card className="shadow-2xs">
        <CardHeader className="p-5 pb-4 border-b border-border/50">
          <CardTitle className="text-sm font-semibold tracking-tight text-foreground uppercase">
            Entry Identifiers
          </CardTitle>
          <CardDescription className="text-xs text-muted-foreground">
            Standard routing and administrative naming attributes.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-foreground">
                Title <span className="text-destructive">*</span>
              </label>
              <Input
                type="text"
                required
                value={title}
                onChange={(e) => handleTitleChange(e.target.value)}
                placeholder="Entry Title"
                className="h-9"
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-foreground">
                Slug <span className="text-destructive">*</span>
              </label>
              <Input
                type="text"
                required
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="entry-slug"
                className="h-9 font-mono text-xs"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Structured Fields Renderer Card */}
      <Card className="shadow-2xs">
        <CardHeader className="p-5 pb-4 border-b border-border/50 flex flex-row items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-primary" />
              <CardTitle className="text-sm font-semibold tracking-tight text-foreground uppercase">
                Structured Data
              </CardTitle>
            </div>
            <CardDescription className="text-xs text-muted-foreground mt-0.5">
              Populate schema-driven values defined by the {model?.name} content model.
            </CardDescription>
          </div>

          {/* Localized fields tab switcher */}
          {hasLocalizableFields && (
            <div className="inline-flex items-center gap-1 bg-muted p-1 rounded-lg text-xs shrink-0 border border-border/60">
              <Globe className="h-3.5 w-3.5 text-muted-foreground ms-1 me-0.5" />
              <button
                type="button"
                onClick={() => setActiveLocaleTab("en")}
                className={`px-2.5 py-1 rounded-md font-medium text-xs transition-all cursor-pointer ${
                  activeLocaleTab === "en"
                    ? "bg-card text-foreground shadow-2xs font-semibold"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                English (EN)
              </button>
              <button
                type="button"
                onClick={() => setActiveLocaleTab("ar")}
                className={`px-2.5 py-1 rounded-md font-medium text-xs transition-all cursor-pointer ${
                  activeLocaleTab === "ar"
                    ? "bg-card text-foreground shadow-2xs font-semibold"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                العربية (AR)
              </button>
            </div>
          )}
        </CardHeader>

        <CardContent className="p-5">
          {model?.fields?.length === 0 ? (
            <p className="text-xs sm:text-sm text-muted-foreground py-4 text-center">
              This model has no custom fields defined.
            </p>
          ) : (
            <div className="space-y-5">
              {model?.fields?.map((field) => {
                const rawVal = formData[field.key];

                // Handle localizable values
                let val = rawVal;
                if (field.localizable) {
                  if (typeof rawVal === "object" && rawVal !== null && !Array.isArray(rawVal)) {
                    val = (rawVal as Record<string, unknown>)[activeLocaleTab];
                  } else if (activeLocaleTab === "en") {
                    val = rawVal;
                  } else {
                    val = "";
                  }
                }

                const onFieldValChange = (newVal: unknown) => {
                  if (field.localizable) {
                    handleLocalizedFieldChange(field.key, activeLocaleTab, newVal);
                  } else {
                    handleFieldChange(field.key, newVal);
                  }
                };

                // 1. BOOLEAN FIELD
                if (field.type === "boolean") {
                  return (
                    <div key={field.id || field.key} className="p-3.5 rounded-lg border border-border/70 bg-muted/10 space-y-1">
                      <div className="flex items-center justify-between">
                        <label className="flex items-center gap-2.5 cursor-pointer text-xs sm:text-sm font-medium text-foreground select-none">
                          <Switch
                            checked={Boolean(val)}
                            onCheckedChange={(checked) => onFieldValChange(checked)}
                          />
                          <span>
                            {field.name} {field.required && <span className="text-destructive">*</span>}
                          </span>
                        </label>
                        {field.localizable && (
                          <Badge variant="secondary" className="text-[10px] uppercase font-mono">
                            {activeLocaleTab}
                          </Badge>
                        )}
                      </div>
                      {field.helpText && (
                        <p className="text-xs text-muted-foreground ms-11">{field.helpText}</p>
                      )}
                    </div>
                  );
                }

                // 2. SINGLE SELECT FIELD
                if (field.type === "select") {
                  return (
                    <div key={field.id || field.key} className="space-y-1.5">
                      <label className="block text-xs font-medium text-foreground">
                        {field.name} {field.required && <span className="text-destructive">*</span>}
                      </label>
                      <select
                        required={field.required}
                        value={String(val || "")}
                        onChange={(e) => onFieldValChange(e.target.value)}
                        className="h-9 w-full rounded-md border border-border/70 bg-background px-3 text-xs sm:text-sm text-foreground shadow-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer"
                      >
                        <option value="">-- Select {field.name} --</option>
                        {field.options?.map((opt) => (
                          <option key={String(opt.value)} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                      {field.helpText && (
                        <p className="text-xs text-muted-foreground">{field.helpText}</p>
                      )}
                    </div>
                  );
                }

                // 3. MULTI-SELECT FIELD
                if (field.type === "multi_select") {
                  const selectedList = Array.isArray(val) ? (val as string[]) : [];
                  return (
                    <div key={field.id || field.key} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="block text-xs font-medium text-foreground">
                          {field.name} {field.required && <span className="text-destructive">*</span>}{" "}
                          <span className="text-muted-foreground font-normal">(Select multiple)</span>
                        </label>
                        <Badge variant="secondary" className="text-[10px] font-mono">
                          {selectedList.length} selected
                        </Badge>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 border border-border/70 bg-muted/10 rounded-lg p-3">
                        {field.options?.map((opt) => {
                          const isChecked = selectedList.includes(String(opt.value));
                          return (
                            <label
                              key={String(opt.value)}
                              className="flex items-center gap-2 text-xs text-foreground hover:text-primary cursor-pointer select-none p-1 rounded hover:bg-muted/40 transition-colors"
                            >
                              <Checkbox
                                checked={isChecked}
                                onCheckedChange={(checked) => {
                                  if (checked) {
                                    onFieldValChange([...selectedList, String(opt.value)]);
                                  } else {
                                    onFieldValChange(
                                      selectedList.filter((x) => x !== String(opt.value)),
                                    );
                                  }
                                }}
                              />
                              <span className="truncate">{opt.label}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  );
                }

                // 4. TAXONOMY / TAGS FIELD
                if (field.type === "taxonomy") {
                  const tags = Array.isArray(val) ? (val as string[]) : [];
                  return (
                    <div key={field.id || field.key} className="space-y-1.5">
                      <label className="block text-xs font-medium text-foreground">
                        {field.name} {field.required && <span className="text-destructive">*</span>}
                      </label>
                      <div className="flex flex-wrap items-center gap-1.5 border border-border/70 bg-background rounded-lg p-2 min-h-[40px] focus-within:ring-2 focus-within:ring-ring">
                        {tags.map((tag, idx) => (
                          <Badge
                            key={idx}
                            variant="secondary"
                            className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium"
                          >
                            <span>{tag}</span>
                            <button
                              type="button"
                              onClick={() => onFieldValChange(tags.filter((_, i) => i !== idx))}
                              className="text-muted-foreground hover:text-destructive cursor-pointer"
                              aria-label={`Remove tag ${tag}`}
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </Badge>
                        ))}
                        <input
                          type="text"
                          placeholder="Add tag and press Enter..."
                          className="flex-1 min-w-[140px] bg-transparent text-xs sm:text-sm text-foreground outline-hidden px-1 placeholder:text-muted-foreground/60"
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              const newTag = (e.currentTarget.value || "").trim();
                              if (newTag && !tags.includes(newTag)) {
                                onFieldValChange([...tags, newTag]);
                                e.currentTarget.value = "";
                              }
                            }
                          }}
                        />
                      </div>
                    </div>
                  );
                }

                // 5. MEDIA FIELD
                if (field.type === "media") {
                  const mediaVal =
                    typeof val === "string"
                      ? val
                      : typeof val === "object" && val !== null
                        ? (val as any).url || (val as any).id
                        : "";

                  return (
                    <div key={field.id || field.key} className="space-y-2">
                      <label className="block text-xs font-medium text-foreground">
                        {field.name} {field.required && <span className="text-destructive">*</span>}
                      </label>
                      <div className="flex items-center gap-3">
                        {mediaVal ? (
                          <div className="relative group size-20 rounded-lg overflow-hidden border border-border/70 bg-muted shrink-0 shadow-2xs">
                            <img
                              src={mediaVal}
                              alt={field.name}
                              className="size-full object-cover"
                              onError={(e) => {
                                (e.currentTarget as HTMLElement).style.display = "none";
                              }}
                            />
                            <button
                              type="button"
                              onClick={() => onFieldValChange("")}
                              className="absolute top-1 end-1 p-1 bg-black/70 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                              aria-label="Remove media asset"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        ) : (
                          <div className="size-20 rounded-lg border-2 border-dashed border-border/80 bg-muted/20 flex items-center justify-center text-muted-foreground shrink-0">
                            <ImageIcon className="h-6 w-6" />
                          </div>
                        )}
                        <div className="flex-1 space-y-1">
                          <Input
                            type="text"
                            required={field.required}
                            value={mediaVal}
                            onChange={(e) => onFieldValChange(e.target.value)}
                            placeholder="Media URL or Asset ID (e.g. /media/uploads/photo.jpg or med_123)"
                            className="h-9"
                          />
                          <p className="text-[11px] text-muted-foreground">
                            Enter canonical media storage path or uploaded asset identifier.
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                }

                // 6. RELATION FIELD (1:1 or N:1)
                if (field.type === "relation") {
                  const targetOptions = relationOptions[field.relationModel || ""] || [];
                  const rawRelVal =
                    typeof val === "string"
                      ? val
                      : typeof val === "object" && val !== null
                        ? (val as any).id || (val as any).slug
                        : "";
                  const matchingOpt = targetOptions.find(
                    (opt) => opt.id === rawRelVal || opt.slug === rawRelVal,
                  );
                  const selectedRelId = matchingOpt ? matchingOpt.id : rawRelVal;

                  return (
                    <div key={field.id || field.key} className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <label className="block text-xs font-medium text-foreground flex items-center gap-1.5">
                          <LinkIcon className="h-3.5 w-3.5 text-primary" />
                          <span>{field.name} {field.required && <span className="text-destructive">*</span>}</span>
                        </label>
                        <Badge variant="secondary" className="text-[10px] font-mono">
                          Target: {field.relationModel || "Model"}
                        </Badge>
                      </div>
                      <select
                        required={field.required}
                        value={selectedRelId}
                        onChange={(e) => onFieldValChange(e.target.value)}
                        className="h-9 w-full rounded-md border border-border/70 bg-background px-3 text-xs sm:text-sm text-foreground shadow-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer"
                      >
                        <option value="">-- Select related {field.relationModel} --</option>
                        {targetOptions.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.title} ({item.slug})
                          </option>
                        ))}
                      </select>
                    </div>
                  );
                }

                // 7. RELATION LIST FIELD (1:N or M:N)
                if (field.type === "relation_list") {
                  const targetOptions = relationOptions[field.relationModel || ""] || [];
                  const selectedIds = Array.isArray(val)
                    ? (val as Array<string | { id: string; slug?: string }>).map((x) =>
                        typeof x === "string" ? x : x.id || (x as any).slug,
                      )
                    : [];

                  const selectedItems = selectedIds
                    .map(
                      (id) =>
                        targetOptions.find((opt) => opt.id === id || opt.slug === id) || {
                          id,
                          title: id,
                          slug: "",
                        },
                    )
                    .filter(Boolean);

                  const moveItem = (index: number, direction: "up" | "down") => {
                    const newIds = [...selectedIds];
                    const targetIndex = direction === "up" ? index - 1 : index + 1;
                    if (targetIndex < 0 || targetIndex >= newIds.length) return;
                    const temp = newIds[index]!;
                    newIds[index] = newIds[targetIndex]!;
                    newIds[targetIndex] = temp;
                    onFieldValChange(newIds);
                  };

                  const removeItem = (idToRemove: string) => {
                    onFieldValChange(
                      selectedIds.filter(
                        (id) =>
                          id !== idToRemove &&
                          targetOptions.find((opt) => (opt.id === id || opt.slug === id) && (opt.id === idToRemove || opt.slug === idToRemove)) === undefined,
                      ),
                    );
                  };

                  const currentSearch = relationSearchQuery[field.key] || "";
                  const filteredTargetOptions = targetOptions.filter((opt) => {
                    if (!currentSearch.trim()) return true;
                    const q = currentSearch.toLowerCase();
                    return opt.title.toLowerCase().includes(q) || opt.slug.toLowerCase().includes(q);
                  });

                  return (
                    <div key={field.id || field.key} className="space-y-3">
                      <div className="flex items-center justify-between">
                        <label className="block text-xs font-medium text-foreground flex items-center gap-1.5">
                          <LinkIcon className="h-3.5 w-3.5 text-primary" />
                          <span>{field.name} {field.required && <span className="text-destructive">*</span>}</span>
                        </label>
                        <div className="flex items-center gap-1.5">
                          <Badge variant="secondary" className="text-[10px] font-mono">
                            Target: {field.relationModel || "None"}
                          </Badge>
                          <Badge variant="outline" className="text-[10px] font-mono">
                            {selectedIds.length} / 100 selected
                          </Badge>
                        </div>
                      </div>

                      {/* Selected Ordered Items */}
                      {selectedItems.length > 0 && (
                        <div className="space-y-1.5 border border-primary/20 bg-primary/5 dark:bg-primary/10 rounded-xl p-3">
                          <span className="text-xs font-semibold text-primary block mb-2">
                            Selected Items ({selectedItems.length}):
                          </span>
                          <div className="space-y-1.5 max-h-56 overflow-y-auto pe-1">
                            {selectedItems.map((item, idx) => (
                              <div
                                key={item.id}
                                className="flex items-center justify-between bg-card border border-border/70 rounded-lg px-3 py-1.5 text-xs shadow-2xs"
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className="font-mono text-muted-foreground text-[10px]">
                                    #{idx + 1}
                                  </span>
                                  <span className="font-medium text-foreground truncate">
                                    {item.title}
                                  </span>
                                  {item.slug && (
                                    <span className="text-muted-foreground font-mono text-[10px] truncate">
                                      ({item.slug})
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                  <button
                                    type="button"
                                    disabled={idx === 0}
                                    onClick={() => moveItem(idx, "up")}
                                    className="p-1 hover:bg-muted rounded text-muted-foreground hover:text-foreground disabled:opacity-20 cursor-pointer"
                                    title="Move up"
                                    aria-label={`Move ${item.title} up`}
                                  >
                                    <ArrowUp className="h-3 w-3" />
                                  </button>
                                  <button
                                    type="button"
                                    disabled={idx === selectedItems.length - 1}
                                    onClick={() => moveItem(idx, "down")}
                                    className="p-1 hover:bg-muted rounded text-muted-foreground hover:text-foreground disabled:opacity-20 cursor-pointer"
                                    title="Move down"
                                    aria-label={`Move ${item.title} down`}
                                  >
                                    <ArrowDown className="h-3 w-3" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => removeItem(item.id)}
                                    className="p-1 hover:bg-destructive/10 rounded text-muted-foreground hover:text-destructive cursor-pointer"
                                    title="Remove item"
                                    aria-label={`Remove ${item.title}`}
                                  >
                                    <X className="h-3 w-3" />
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Available Items Picker Box */}
                      <div className="rounded-xl border border-border/70 bg-card p-3 space-y-2 shadow-2xs">
                        <div className="relative">
                          <Search className="absolute start-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                          <Input
                            type="text"
                            placeholder={field.relationModel ? `Search ${field.relationModel} entries to attach...` : "Search related entries to attach..."}
                            value={currentSearch}
                            onChange={(e) =>
                              setRelationSearchQuery((prev) => ({
                                ...prev,
                                [field.key]: e.target.value,
                              }))
                            }
                            className="h-8 ps-8 text-xs bg-background"
                          />
                        </div>

                        <div className="max-h-40 overflow-y-auto space-y-1 pe-1">
                          {targetOptions.length === 0 ? (
                            <p className="text-xs text-muted-foreground py-2 px-2 text-center">
                              {field.relationModel
                                ? `No available entries found in target model ${field.relationModel}.`
                                : "No target relation model selected."}
                            </p>
                          ) : filteredTargetOptions.length === 0 ? (
                            <p className="text-xs text-muted-foreground py-2 px-2 text-center">
                              No entries match "{currentSearch}".
                            </p>
                          ) : (
                            filteredTargetOptions.map((item) => {
                              const isChecked = selectedIds.some((id) => id === item.id || id === item.slug);
                              return (
                                <label
                                  key={item.id}
                                  className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs cursor-pointer transition-colors ${
                                    isChecked
                                      ? "bg-primary/5 dark:bg-primary/10 text-primary font-medium"
                                      : "hover:bg-muted text-foreground"
                                  }`}
                                >
                                  <Checkbox
                                    checked={isChecked}
                                    onCheckedChange={(checked) => {
                                      if (checked) {
                                        if (selectedIds.length < 100) {
                                          onFieldValChange([...selectedIds, item.id]);
                                        }
                                      } else {
                                        onFieldValChange(
                                          selectedIds.filter((id) => id !== item.id && id !== item.slug),
                                        );
                                      }
                                    }}
                                  />
                                  <span className="truncate">{item.title}</span>
                                  <span className="text-muted-foreground font-mono text-[10px] truncate ms-auto">
                                    ({item.slug})
                                  </span>
                                </label>
                              );
                            })
                          )}
                        </div>
                      </div>
                    </div>
                  );
                }

                // 8. JSON STRUCTURED FIELD
                if (field.type === "json") {
                  const jsonString =
                    typeof val === "object" && val !== null
                      ? JSON.stringify(val, null, 2)
                      : typeof val === "string"
                        ? val
                        : "{}";

                  return (
                    <div key={field.id || field.key} className="space-y-1.5">
                      <label className="block text-xs font-medium text-foreground flex items-center gap-1.5">
                        <Code className="h-3.5 w-3.5 text-muted-foreground" />
                        <span>{field.name} {field.required && <span className="text-destructive">*</span>} (JSON)</span>
                      </label>
                      <Textarea
                        rows={5}
                        required={field.required}
                        value={jsonString}
                        onChange={(e) => {
                          try {
                            const parsed = JSON.parse(e.target.value);
                            onFieldValChange(parsed);
                          } catch {
                            onFieldValChange(e.target.value);
                          }
                        }}
                        className="font-mono text-xs bg-muted/30 text-foreground"
                        placeholder='{ "key": "value" }'
                      />
                    </div>
                  );
                }

                // 9. RICH TEXT & STUDIO DOC FIELD
                if (field.type === "rich_text" || field.type === "studio_doc") {
                  return (
                    <div key={field.id || field.key} className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <label className="block text-xs font-medium text-foreground flex items-center gap-1.5">
                          <FileText className="h-3.5 w-3.5 text-primary" />
                          <span>{field.name} {field.required && <span className="text-destructive">*</span>}</span>
                        </label>
                        {field.localizable && (
                          <Badge variant="secondary" className="text-[10px] uppercase font-mono">
                            {activeLocaleTab}
                          </Badge>
                        )}
                      </div>
                      <Textarea
                        rows={6}
                        required={field.required}
                        value={String(val || "")}
                        dir={activeLocaleTab === "ar" ? "rtl" : "ltr"}
                        onChange={(e) => onFieldValChange(e.target.value)}
                        placeholder={`Enter formatted content for ${field.name}...`}
                        className="text-xs sm:text-sm"
                      />
                    </div>
                  );
                }

                // 10. LONG TEXT FIELD
                if (field.type === "long_text") {
                  return (
                    <div key={field.id || field.key} className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <label className="block text-xs font-medium text-foreground">
                          {field.name} {field.required && <span className="text-destructive">*</span>}
                        </label>
                        {field.localizable && (
                          <Badge variant="secondary" className="text-[10px] uppercase font-mono">
                            {activeLocaleTab}
                          </Badge>
                        )}
                      </div>
                      <Textarea
                        rows={4}
                        required={field.required}
                        value={String(val || "")}
                        dir={activeLocaleTab === "ar" ? "rtl" : "ltr"}
                        onChange={(e) => onFieldValChange(e.target.value)}
                        placeholder={`Enter ${field.name}...`}
                        className="text-xs sm:text-sm"
                      />
                    </div>
                  );
                }

                // 11. STANDARD INPUTS (text, number, date, datetime, url, email)
                const inputType =
                  field.type === "number"
                    ? "number"
                    : field.type === "date"
                      ? "date"
                      : field.type === "datetime"
                        ? "datetime-local"
                        : field.type === "email"
                          ? "email"
                          : field.type === "url"
                            ? "url"
                            : "text";

                return (
                  <div key={field.id || field.key} className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="block text-xs font-medium text-foreground">
                        {field.name} {field.required && <span className="text-destructive">*</span>}
                      </label>
                      {field.localizable && (
                        <Badge variant="secondary" className="text-[10px] uppercase font-mono">
                          {activeLocaleTab}
                        </Badge>
                      )}
                    </div>
                    <Input
                      type={inputType}
                      required={field.required}
                      dir={activeLocaleTab === "ar" && (field.type === "text" || field.type === "short_text") ? "rtl" : "ltr"}
                      value={val !== undefined && val !== null ? String(val) : ""}
                      onChange={(e) =>
                        onFieldValChange(
                          field.type === "number"
                            ? e.target.value === ""
                              ? ""
                              : Number(e.target.value)
                            : e.target.value,
                        )
                      }
                      placeholder={`Enter ${field.name}...`}
                      className="h-9 text-xs sm:text-sm"
                    />
                    {field.helpText && (
                      <p className="text-xs text-muted-foreground">{field.helpText}</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </form>
  );
}
