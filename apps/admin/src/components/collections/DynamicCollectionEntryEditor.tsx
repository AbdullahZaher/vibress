import React, { useState, useEffect } from "react";
import {
  ArrowLeft,
  Save,
  X,
  Image as ImageIcon,
  Globe,
  Code,
  CheckCircle,
  FileText,
  AlertTriangle,
} from "lucide-react";
import { apiRequest, ApiError } from "../../lib/api/client";
import { MediaPicker } from "../MediaPicker";
import { RelationEntryPicker } from "./RelationEntryPicker";
import { VibressStudio } from "@vibress/studio-react";
import { migrateDocument } from "@vibress/studio-core";
import { Button } from "../ui/button";

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

/** Stable document state across parent form rerenders; localized editors remount on locale change. */
function StudioDocumentInput({
  value,
  onChange,
}: {
  value: unknown;
  onChange: (value: ReturnType<typeof migrateDocument>) => void;
}) {
  const [document, setDocument] = useState(() => migrateDocument(value));
  return (
    <VibressStudio
      value={document}
      onChange={(next) => {
        setDocument(next);
        onChange(next);
      }}
    />
  );
}

export function DynamicCollectionEntryEditor({
  modelSlug,
  entryId,
  onNavigate,
  canPublish = false,
}: {
  modelSlug: string;
  entryId?: string | undefined;
  onNavigate: (path: string) => void;
  canPublish?: boolean;
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
  const [mediaFieldKey, setMediaFieldKey] = useState<string | null>(null);
  const [entryVersion, setEntryVersion] = useState<number | undefined>(undefined);
  const [conflictState, setConflictState] = useState<{
    isConflict: boolean;
    expectedVersion?: number | undefined;
    currentVersion?: number | undefined;
  } | null>(null);

  // Localization active editor tab (for localizable fields)
  const [activeLocaleTab, setActiveLocaleTab] = useState("en");
  const [defaultLocale, setDefaultLocale] = useState("en");
  const [enabledLocales, setEnabledLocales] = useState<string[]>(["en"]);
  const isRtlLocale = /^(ar|fa|he|ur)(-|$)/i.test(activeLocaleTab);

  const reloadLatestVersion = async () => {
    if (!isEditing || !entryId) return;
    try {
      setLoading(true);
      setError(null);
      setConflictState(null);
      const entryRes = await apiRequest<{
        data?: {
          title: string;
          slug: string;
          status: "draft" | "published" | "archived";
          data: Record<string, unknown>;
          version?: number;
        };
        entry?: {
          title: string;
          slug: string;
          status: "draft" | "published" | "archived";
          data: Record<string, unknown>;
          version?: number;
        };
      }>(`/content-models/${modelSlug}/entries/${entryId}`);
      const ent = entryRes.data || entryRes.entry;
      if (ent) {
        setTitle(ent.title);
        setSlug(ent.slug);
        setStatus(ent.status);
        setFormData(ent.data || {});
        setEntryVersion(ent.version);
        setSuccess("Latest version loaded from server.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reload entry");
    } finally {
      setLoading(false);
    }
  };

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
        const localeResponse = await apiRequest<{
          data?: { defaultLocale: string; enabledLocales: string[] };
        }>("/content-models/locales").catch(() => null);
        if (localeResponse?.data) {
          const primary = localeResponse.data.defaultLocale || "en";
          const configured = localeResponse.data.enabledLocales;
          setDefaultLocale(primary);
          setEnabledLocales(configured.length ? configured : [primary]);
          setActiveLocaleTab(primary);
        }

        // If editing, load entry
        if (isEditing && entryId) {
          const entryRes = await apiRequest<{
            data?: {
              title: string;
              slug: string;
              status: "draft" | "published" | "archived";
              data: Record<string, unknown>;
              version?: number;
            };
            entry?: {
              title: string;
              slug: string;
              status: "draft" | "published" | "archived";
              data: Record<string, unknown>;
              version?: number;
            };
          }>(`/content-models/${modelSlug}/entries/${entryId}`);
          const ent = entryRes.data || entryRes.entry;
          if (ent) {
            setTitle(ent.title);
            setSlug(ent.slug);
            setStatus(ent.status);
            setFormData(ent.data || {});
            setEntryVersion(ent.version);
            setConflictState(null);
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
          .replace(/[^\p{L}\p{M}\p{N}]+/gu, "-")
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
        dict = { [defaultLocale]: current };
      }
      const existingKey = Object.keys(dict).find(
        (key) => key.toLowerCase() === locale.toLowerCase(),
      );
      dict[existingKey ?? locale] = value;
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
        ...(canPublish ? { status } : {}),
        data: formData,
        ...(isEditing && typeof entryVersion === "number"
          ? { expectedVersion: entryVersion }
          : {}),
      };

      if (isEditing) {
        const updateRes = await apiRequest<{
          data?: { version?: number };
        }>(`/content-models/${modelSlug}/entries/${entryId}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
        if (updateRes.data?.version) {
          setEntryVersion(updateRes.data.version);
        }
      } else {
        await apiRequest(`/content-models/${modelSlug}/entries`, {
          method: "POST",
          body: JSON.stringify(payload),
        });
      }

      setConflictState(null);
      setSuccess("Entry saved successfully.");
      setTimeout(() => {
        onNavigate(`/admin/collections/${modelSlug}`);
      }, 500);
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 409) {
        setConflictState({
          isConflict: true,
          expectedVersion: entryVersion,
        });
        setError(
          "Edit Conflict (409): Another user modified this entry in the meantime. Please reload the latest version to avoid overwriting their work.",
        );
      } else {
        setError(err instanceof Error ? err.message : "Failed to save entry");
      }
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin mr-2" />
        Loading entry editor...
      </div>
    );
  }

  const hasLocalizableFields = model?.fields.some((f) => f.localizable);

  return (
    <form onSubmit={handleSave} className="mx-auto w-full max-w-6xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            type="button"
            aria-label="Back to collection entries"
            onClick={() => onNavigate(`/admin/collections/${modelSlug}`)}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeft className="h-4 w-4 rtl:rotate-180" />
          </button>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
              {isEditing ? `Edit ${model?.name || "Entry"}: ${title}` : `New ${model?.name || "Entry"}`}
            </h1>
            <p className="text-xs text-muted-foreground font-mono">Collection: {modelSlug}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {canPublish && <select
            aria-label="Publication status"
            value={status}
            onChange={(e) => setStatus(e.target.value as "draft" | "published" | "archived")}
            className="rounded-md border border-border/70 bg-background px-3 py-1.5 text-xs font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="draft">Draft</option>
            <option value="published">Published</option>
            {isEditing && <option value="archived">Archived</option>}
          </select>}
          <button
            type="submit"
            disabled={saving}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground shadow-2xs hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            {saving ? "Saving..." : "Save Entry"}
          </button>
        </div>
      </div>

      {conflictState?.isConflict && (
        <div
          role="alert"
          className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-4 text-amber-900 dark:text-amber-200"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
            <div className="space-y-1">
              <h3 className="font-semibold text-sm">Concurrent Edit Conflict Detected</h3>
              <p className="text-xs opacity-90">
                Another user or browser session updated this entry while you were editing (Version {entryVersion ?? 1} is stale).
                To avoid overwriting their work, reload the latest version from the server.
              </p>
              <div className="pt-2 flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={reloadLatestVersion}
                  className="bg-background text-foreground text-xs"
                >
                  Reload Latest Version
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setConflictState(null)}
                  className="text-xs"
                >
                  Dismiss
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div role="alert" className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-xs text-destructive">
          {error}
        </div>
      )}

      {success && (
        <div role="status" className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs text-emerald-700 dark:text-emerald-400">
          <CheckCircle className="w-4 h-4" />
          {success}
        </div>
      )}

      {/* Core Identifiers */}
      <div className="space-y-4 rounded-xl border border-border/70 bg-card p-5 shadow-2xs">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="collection-entry-title" className="block text-xs font-medium text-foreground/85 mb-1">
              Title *
            </label>
            <input
              id="collection-entry-title"
              type="text"
              required
              value={title}
              onChange={(e) => handleTitleChange(e.target.value)}
              placeholder="Entry Title"
              className="w-full px-3 py-2 border border-border/70 rounded-md bg-transparent text-sm"
            />
          </div>
          <div>
            <label htmlFor="collection-entry-slug" className="block text-xs font-medium text-foreground/85 mb-1">
              Slug *
            </label>
            <input
              id="collection-entry-slug"
              dir="ltr"
              type="text"
              required
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="entry-slug"
              className="w-full px-3 py-2 border border-border/70 rounded-md bg-transparent font-mono text-sm"
            />
          </div>
        </div>
      </div>

      {/* Structured Fields Renderer */}
      <div className="space-y-6 rounded-xl border border-border/70 bg-card p-5 shadow-2xs">
        <div className="flex items-center justify-between border-b border-border/70 pb-3">
          <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider">
            Structured Data
          </h2>
          {hasLocalizableFields && (
            <div className="flex flex-wrap items-center gap-1 rounded-md bg-muted p-1 text-xs">
              <Globe className="w-3.5 h-3.5 text-muted-foreground mr-1" />
              {enabledLocales.map((locale) => (
                <button
                  key={locale}
                  type="button"
                  lang={locale}
                  dir={/^(ar|fa|he|ur)(-|$)/i.test(locale) ? "rtl" : "ltr"}
                  aria-pressed={activeLocaleTab === locale}
                  onClick={() => setActiveLocaleTab(locale)}
                  className={`rounded-md px-2.5 py-1 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    activeLocaleTab === locale
                      ? "bg-card text-foreground shadow-2xs ring-1 ring-border/70"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {locale === "en" ? "English" : locale.startsWith("ar") ? "العربية" : locale}
                </button>
              ))}
            </div>
          )}
        </div>

        {model?.fields?.length === 0 ? (
          <p className="text-sm text-muted-foreground">This model has no custom fields defined.</p>
        ) : (
          <div className="space-y-5">
            {model?.fields?.map((field) => {
              const rawVal = formData[field.key];

              // Handle localizable values
              let val = rawVal;
              if (field.localizable) {
                if (typeof rawVal === "object" && rawVal !== null && !Array.isArray(rawVal)) {
                  const dictionary = rawVal as Record<string, unknown>;
                  const localeKey = Object.keys(dictionary).find(
                    (key) => key.toLowerCase() === activeLocaleTab.toLowerCase(),
                  );
                  val = localeKey ? dictionary[localeKey] : undefined;
                } else if (activeLocaleTab === defaultLocale) {
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
                    <label className="flex items-center gap-3 cursor-pointer text-sm font-medium text-foreground/85">
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
                      <p className="text-xs text-muted-foreground mt-1 ml-7">{field.helpText}</p>
                    )}
                  </div>
                );
              }

              // 2. SINGLE SELECT FIELD
              if (field.type === "select") {
                return (
                  <div key={field.id || field.key}>
                    <label className="block text-xs font-medium text-foreground/85 mb-1">
                      {field.name} {field.required && "*"}
                    </label>
                    <select
                      required={field.required}
                      value={String(val || "")}
                      onChange={(e) => onFieldValChange(e.target.value)}
                      className="w-full px-3 py-2 border border-border/70 rounded-md bg-transparent text-sm"
                    >
                      <option value="">-- Select {field.name} --</option>
                      {field.options?.map((opt) => (
                        <option key={String(opt.value)} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                    {field.helpText && (
                      <p className="text-xs text-muted-foreground mt-1">{field.helpText}</p>
                    )}
                  </div>
                );
              }

              // 3. MULTI-SELECT FIELD
              if (field.type === "multi_select") {
                const selectedList = Array.isArray(val) ? (val as string[]) : [];
                return (
                  <div key={field.id || field.key} className="space-y-2">
                    <label className="block text-xs font-medium text-foreground/85">
                      {field.name} {field.required && "*"} (Select multiple)
                    </label>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 border border-border/70 rounded-md p-3">
                      {field.options?.map((opt) => {
                        const isChecked = selectedList.includes(String(opt.value));
                        return (
                          <label
                            key={String(opt.value)}
                            className="flex items-center gap-2 text-xs text-foreground/85 cursor-pointer"
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
                    <label className="block text-xs font-medium text-foreground/85">
                      {field.name} {field.required && "*"}
                    </label>
                    <div className="flex flex-wrap items-center gap-2 border border-border/70 rounded-md p-2">
                      {tags.map((tag, idx) => (
                        <span
                          key={idx}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 rounded-md text-xs font-medium"
                        >
                          {tag}
                          <button
                            type="button"
                            onClick={() => onFieldValChange(tags.filter((_, i) => i !== idx))}
                            className="text-muted-foreground hover:text-destructive"
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
                    <label className="block text-xs font-medium text-foreground/85">
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
                            aria-label={`Remove ${field.name} media`}
                            className="absolute top-1 right-1 p-1 bg-black/60 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ) : (
                        <div className="w-20 h-20 rounded-md border-2 border-dashed border-border/70 flex items-center justify-center text-muted-foreground shrink-0">
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
                          className="w-full px-3 py-2 border border-border/70 rounded-md bg-transparent text-sm"
                        />
                        <button type="button"
                          onClick={() => setMediaFieldKey(field.key)}
                          className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted">
                          Choose from Media Library
                        </button>
                        <p className="text-xs text-muted-foreground">
                          Select an uploaded asset or enter a canonical URL or identifier.
                        </p>
                      </div>
                    </div>
                  </div>
                );
              }

              // Relation pickers paginate through publication-scoped admin APIs.
              if (field.type === "relation" || field.type === "relation_list") {
                return (
                  <RelationEntryPicker
                    key={field.id || field.key}
                    fieldName={field.name}
                    targetModel={field.relationModel}
                    multiple={field.type === "relation_list"}
                    required={field.required}
                    maxItems={field.max}
                    value={val}
                    onChange={onFieldValChange}
                  />
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
                    <label className="block text-xs font-medium text-foreground/85 flex items-center gap-1.5">
                      <Code className="w-3.5 h-3.5 text-muted-foreground" />
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
                      className="w-full px-3 py-2 border border-border/70 rounded-md bg-slate-950 text-slate-100 font-mono text-xs"
                      placeholder='{ "key": "value" }'
                    />
                  </div>
                );
              }

              // Keep Studio AST structured; preserve legacy string values until edited.
              if (field.type === "studio_doc") {
                return (
                  <div key={field.id || field.key} className="space-y-2">
                    <div className="text-xs font-medium text-foreground/85">
                      {field.name} {field.required && "*"}
                      {field.localizable && <span className="ms-2 text-primary">{activeLocaleTab}</span>}
                    </div>
                    <div className="rounded-lg border border-border overflow-hidden"
                      lang={activeLocaleTab} dir={isRtlLocale ? "rtl" : "ltr"}>
                      <StudioDocumentInput
                        key={`${field.key}-${field.localizable ? activeLocaleTab : "base"}`}
                        value={val}
                        onChange={onFieldValChange}
                      />
                    </div>
                  </div>
                );
              }

              // Rich text / Markdown remains a string for backward compatibility.
              if (field.type === "rich_text") {
                return (
                  <div key={field.id || field.key} className="space-y-1">
                    <label className="block text-xs font-medium text-foreground/85 flex items-center gap-1.5">
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
                      dir={isRtlLocale ? "rtl" : "ltr"}
                      onChange={(e) => onFieldValChange(e.target.value)}
                      placeholder={`Enter formatted content for ${field.name}...`}
                      className="w-full px-3 py-2 border border-border/70 rounded-md bg-transparent text-sm"
                    />
                  </div>
                );
              }

              // 10. LONG TEXT FIELD
              if (field.type === "long_text") {
                return (
                  <div key={field.id || field.key}>
                    <label className="block text-xs font-medium text-foreground/85 mb-1">
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
                      dir={isRtlLocale ? "rtl" : "ltr"}
                      onChange={(e) => onFieldValChange(e.target.value)}
                      placeholder={`Enter ${field.name}...`}
                      className="w-full px-3 py-2 border border-border/70 rounded-md bg-transparent text-sm"
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
                  <label className="block text-xs font-medium text-foreground/85 mb-1">
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
                    dir={isRtlLocale && (field.type === "text" || field.type === "short_text") ? "rtl" : "ltr"}
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
                    className="w-full px-3 py-2 border border-border/70 rounded-md bg-transparent text-sm"
                  />
                  {field.helpText && (
                    <p className="text-xs text-muted-foreground mt-1">{field.helpText}</p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      {mediaFieldKey !== null && (
        <MediaPicker
          onClose={() => setMediaFieldKey(null)}
          onSelectAsset={(asset) => {
            handleFieldChange(mediaFieldKey, asset.url || asset.id);
            setMediaFieldKey(null);
          }}
        />
      )}
    </form>
  );
}
