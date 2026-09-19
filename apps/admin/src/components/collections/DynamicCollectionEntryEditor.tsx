import React, { useState, useEffect } from "react";
import {
  ArrowLeft,
  Save,
  X,
  Image as ImageIcon,
  Link as LinkIcon,
  Globe,
  Code,
  CheckCircle,
  FileText,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import { apiRequest } from "../../lib/api/client";

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
      <div className="flex items-center justify-center py-24 text-slate-500">
        <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin mr-2" />
        Loading entry editor...
      </div>
    );
  }

  const hasLocalizableFields = model?.fields.some((f) => f.localizable);

  return (
    <form onSubmit={handleSave} className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => onNavigate(`/admin/collections/${modelSlug}`)}
            className="p-1.5 text-slate-500 hover:text-slate-900 dark:hover:text-white rounded hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">
              {isEditing ? `Edit ${model?.name || "Entry"}: ${title}` : `New ${model?.name || "Entry"}`}
            </h1>
            <p className="text-xs text-slate-500 font-mono">Collection: {modelSlug}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as "draft" | "published" | "archived")}
            className="px-3 py-1.5 border border-slate-300 dark:border-slate-700 rounded-md bg-transparent text-xs font-medium"
          >
            <option value="draft">Draft</option>
            <option value="published">Published</option>
            <option value="archived">Archived</option>
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

      {success && (
        <div className="p-4 bg-emerald-500/10 text-emerald-600 rounded-md text-sm flex items-center gap-2">
          <CheckCircle className="w-4 h-4" />
          {success}
        </div>
      )}

      {/* Core Identifiers */}
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

      {/* Structured Fields Renderer */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-6">
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white uppercase tracking-wider">
            Structured Data
          </h2>
          {hasLocalizableFields && (
            <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-md text-xs">
              <Globe className="w-3.5 h-3.5 text-slate-500 mr-1" />
              <button
                type="button"
                onClick={() => setActiveLocaleTab("en")}
                className={`px-2.5 py-1 rounded font-medium transition-colors ${
                  activeLocaleTab === "en"
                    ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs"
                    : "text-slate-500 hover:text-slate-900 dark:hover:text-white"
                }`}
              >
                English (EN)
              </button>
              <button
                type="button"
                onClick={() => setActiveLocaleTab("ar")}
                className={`px-2.5 py-1 rounded font-medium transition-colors ${
                  activeLocaleTab === "ar"
                    ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs"
                    : "text-slate-500 hover:text-slate-900 dark:hover:text-white"
                }`}
              >
                العربية (AR)
              </button>
            </div>
          )}
        </div>

        {model?.fields?.length === 0 ? (
          <p className="text-sm text-slate-500">This model has no custom fields defined.</p>
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
                  <div key={field.id || field.key} className="pt-1">
                    <label className="flex items-center gap-3 cursor-pointer text-sm font-medium text-slate-700 dark:text-slate-300">
                      <input
                        type="checkbox"
                        checked={Boolean(val)}
                        onChange={(e) => onFieldValChange(e.target.checked)}
                        className="rounded border-slate-300 text-primary focus:ring-primary h-4 w-4"
                      />
                      <span>
                        {field.name} {field.required && "*"}
                      </span>
                    </label>
                    {field.helpText && (
                      <p className="text-xs text-slate-500 mt-1 ml-7">{field.helpText}</p>
                    )}
                  </div>
                );
              }

              // 2. SINGLE SELECT FIELD
              if (field.type === "select") {
                return (
                  <div key={field.id || field.key}>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      {field.name} {field.required && "*"}
                    </label>
                    <select
                      required={field.required}
                      value={String(val || "")}
                      onChange={(e) => onFieldValChange(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-md bg-transparent text-sm"
                    >
                      <option value="">-- Select {field.name} --</option>
                      {field.options?.map((opt) => (
                        <option key={String(opt.value)} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                    {field.helpText && (
                      <p className="text-xs text-slate-500 mt-1">{field.helpText}</p>
                    )}
                  </div>
                );
              }

              // 3. MULTI-SELECT FIELD
              if (field.type === "multi_select") {
                const selectedList = Array.isArray(val) ? (val as string[]) : [];
                return (
                  <div key={field.id || field.key} className="space-y-2">
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                      {field.name} {field.required && "*"} (Select multiple)
                    </label>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 border border-slate-200 dark:border-slate-800 rounded-md p-3">
                      {field.options?.map((opt) => {
                        const isChecked = selectedList.includes(String(opt.value));
                        return (
                          <label
                            key={String(opt.value)}
                            className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  onFieldValChange([...selectedList, String(opt.value)]);
                                } else {
                                  onFieldValChange(
                                    selectedList.filter((x) => x !== String(opt.value)),
                                  );
                                }
                              }}
                              className="rounded border-slate-300 text-primary h-3.5 w-3.5"
                            />
                            {opt.label}
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
                  <div key={field.id || field.key} className="space-y-2">
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                      {field.name} {field.required && "*"}
                    </label>
                    <div className="flex flex-wrap items-center gap-2 border border-slate-300 dark:border-slate-700 rounded-md p-2">
                      {tags.map((tag, idx) => (
                        <span
                          key={idx}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 rounded-md text-xs font-medium"
                        >
                          {tag}
                          <button
                            type="button"
                            onClick={() => onFieldValChange(tags.filter((_, i) => i !== idx))}
                            className="text-slate-400 hover:text-destructive"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                      <input
                        type="text"
                        placeholder="Add tag and press Enter..."
                        className="flex-1 min-w-[120px] bg-transparent text-xs outline-hidden px-1"
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
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                      {field.name} {field.required && "*"}
                    </label>
                    <div className="flex items-center gap-3">
                      {mediaVal ? (
                        <div className="relative group w-20 h-20 rounded-md overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 shrink-0">
                          <img
                            src={mediaVal}
                            alt={field.name}
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              // If broken image or asset ID, show fallback placeholder
                              (e.currentTarget as HTMLElement).style.display = "none";
                            }}
                          />
                          <button
                            type="button"
                            onClick={() => onFieldValChange("")}
                            className="absolute top-1 right-1 p-1 bg-black/60 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ) : (
                        <div className="w-20 h-20 rounded-md border-2 border-dashed border-slate-300 dark:border-slate-700 flex items-center justify-center text-slate-400 shrink-0">
                          <ImageIcon className="w-6 h-6" />
                        </div>
                      )}
                      <div className="flex-1 space-y-1">
                        <input
                          type="text"
                          required={field.required}
                          value={mediaVal}
                          onChange={(e) => onFieldValChange(e.target.value)}
                          placeholder="Media URL or Asset ID (e.g. /media/uploads/photo.jpg or med_123)"
                          className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-md bg-transparent text-sm"
                        />
                        <p className="text-xs text-slate-500">
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
                  <div key={field.id || field.key}>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1 flex items-center gap-1.5">
                      <LinkIcon className="w-3.5 h-3.5 text-primary" />
                      {field.name} {field.required && "*"} (Target: {field.relationModel || "Model"})
                    </label>
                    <select
                      required={field.required}
                      value={selectedRelId}
                      onChange={(e) => onFieldValChange(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-md bg-transparent text-sm"
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

                return (
                  <div key={field.id || field.key} className="space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                        <LinkIcon className="w-3.5 h-3.5 text-primary" />
                        {field.name} {field.required && "*"} (Multi-relation to: {field.relationModel || "Model"})
                      </label>
                      <span className="text-[11px] font-mono text-slate-400 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">
                        {selectedIds.length} selected
                      </span>
                    </div>

                    {/* Selected Ordered Items */}
                    {selectedItems.length > 0 && (
                      <div className="space-y-1.5 border border-primary/20 bg-primary/5 dark:bg-primary/10 rounded-md p-2">
                        <span className="text-[11px] font-semibold text-primary block">
                          Selected Items (Drag / Reorder):
                        </span>
                        {selectedItems.map((item, idx) => (
                          <div
                            key={item.id}
                            className="flex items-center justify-between bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded px-2.5 py-1 text-xs"
                          >
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-slate-400 text-[10px]">#{idx + 1}</span>
                              <span className="font-medium text-slate-800 dark:text-slate-200">
                                {item.title}
                              </span>
                              {item.slug && (
                                <span className="text-slate-400 font-mono text-[10px]">({item.slug})</span>
                              )}
                            </div>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                disabled={idx === 0}
                                onClick={() => moveItem(idx, "up")}
                                className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded disabled:opacity-30 text-slate-600 dark:text-slate-300"
                                title="Move up"
                              >
                                <ArrowUp className="w-3 h-3" />
                              </button>
                              <button
                                type="button"
                                disabled={idx === selectedItems.length - 1}
                                onClick={() => moveItem(idx, "down")}
                                className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded disabled:opacity-30 text-slate-600 dark:text-slate-300"
                                title="Move down"
                              >
                                <ArrowDown className="w-3 h-3" />
                              </button>
                              <button
                                type="button"
                                onClick={() => removeItem(item.id)}
                                className="p-1 hover:bg-rose-100 dark:hover:bg-rose-900/40 rounded text-rose-500"
                                title="Remove item"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Available Items Picker */}
                    <div className="max-h-40 overflow-y-auto border border-slate-200 dark:border-slate-800 rounded-md p-2 space-y-1">
                      {targetOptions.length === 0 ? (
                        <p className="text-xs text-slate-500 py-1 px-2">
                          No available entries found in target model {field.relationModel}.
                        </p>
                      ) : (
                        targetOptions.map((item) => {
                          const isChecked = selectedIds.some((id) => id === item.id || id === item.slug);
                          return (
                            <label
                              key={item.id}
                              className="flex items-center gap-2 px-2 py-1 hover:bg-slate-50 dark:hover:bg-slate-800/50 rounded text-xs cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    onFieldValChange([...selectedIds, item.id]);
                                  } else {
                                    onFieldValChange(
                                      selectedIds.filter((id) => id !== item.id && id !== item.slug),
                                    );
                                  }
                                }}
                                className="rounded border-slate-300 text-primary h-3.5 w-3.5"
                              />
                              <span className="font-medium text-slate-800 dark:text-slate-200">
                                {item.title}
                              </span>
                              <span className="text-slate-400 font-mono text-[10px]">
                                ({item.slug})
                              </span>
                            </label>
                          );
                        })
                      )}
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
                  <div key={field.id || field.key} className="space-y-1">
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                      <Code className="w-3.5 h-3.5 text-slate-500" />
                      {field.name} {field.required && "*"} (JSON)
                    </label>
                    <textarea
                      rows={5}
                      required={field.required}
                      value={jsonString}
                      onChange={(e) => {
                        try {
                          const parsed = JSON.parse(e.target.value);
                          onFieldValChange(parsed);
                        } catch {
                          // Keep string until valid
                          onFieldValChange(e.target.value);
                        }
                      }}
                      className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-md bg-slate-950 text-slate-100 font-mono text-xs"
                      placeholder='{ "key": "value" }'
                    />
                  </div>
                );
              }

              // 9. RICH TEXT & STUDIO DOC FIELD
              if (field.type === "rich_text" || field.type === "studio_doc") {
                return (
                  <div key={field.id || field.key} className="space-y-1">
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                      <FileText className="w-3.5 h-3.5 text-primary" />
                      {field.name} {field.required && "*"}
                      {field.localizable && (
                        <span className="text-[10px] uppercase font-bold text-primary px-1.5 py-0.5 bg-primary/10 rounded">
                          {activeLocaleTab}
                        </span>
                      )}
                    </label>
                    <textarea
                      rows={6}
                      required={field.required}
                      value={String(val || "")}
                      dir={activeLocaleTab === "ar" ? "rtl" : "ltr"}
                      onChange={(e) => onFieldValChange(e.target.value)}
                      placeholder={`Enter formatted content for ${field.name}...`}
                      className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-md bg-transparent text-sm"
                    />
                  </div>
                );
              }

              // 10. LONG TEXT FIELD
              if (field.type === "long_text") {
                return (
                  <div key={field.id || field.key}>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      {field.name} {field.required && "*"}
                      {field.localizable && (
                        <span className="text-[10px] uppercase font-bold text-primary ml-1.5 px-1.5 py-0.5 bg-primary/10 rounded">
                          {activeLocaleTab}
                        </span>
                      )}
                    </label>
                    <textarea
                      rows={4}
                      required={field.required}
                      value={String(val || "")}
                      dir={activeLocaleTab === "ar" ? "rtl" : "ltr"}
                      onChange={(e) => onFieldValChange(e.target.value)}
                      placeholder={`Enter ${field.name}...`}
                      className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-md bg-transparent text-sm"
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
                <div key={field.id || field.key}>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    {field.name} {field.required && "*"}
                    {field.localizable && (
                      <span className="text-[10px] uppercase font-bold text-primary ml-1.5 px-1.5 py-0.5 bg-primary/10 rounded">
                        {activeLocaleTab}
                      </span>
                    )}
                  </label>
                  <input
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
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-md bg-transparent text-sm"
                  />
                  {field.helpText && (
                    <p className="text-xs text-slate-500 mt-1">{field.helpText}</p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </form>
  );
}
