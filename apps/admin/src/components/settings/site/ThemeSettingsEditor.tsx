import React, { useEffect, useId, useRef, useState } from "react";
import {
  type ApiThemeDetail,
  type ApiThemeSummary,
  type ApiThemeSettingDefinition,
  getThemeApi,
  updateThemeSettingsApi,
} from "../../../lib/api";
import { Button } from "../../ui/button";
import { useAdminLocale } from "../../../lib/admin-locale";
import { Input } from "../../ui/input";
import { AlertCircle, ArrowLeft, CheckCircle2, Loader2, Save } from "lucide-react";

/** Native color inputs support 6-digit RGB only; keep stored alpha/text intact. */
export function toColorPickerHex(color: unknown): string {
  if (typeof color !== "string") return "#000000";
  if (/^#[0-9a-fA-F]{6}$/.test(color)) return color;
  if (/^#[0-9a-fA-F]{8}$/.test(color)) return color.slice(0, 7);
  if (/^#[0-9a-fA-F]{3,4}$/.test(color)) {
    return `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`;
  }
  return "#000000";
}

/** Groups only actual schema-defined settings; no fabricated design controls. */
/** Schema keys may be camelCase; the UI must not show raw implementation identifiers. */
export function themeFieldLabel(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
export function themeSettingCategory(key: string): string {
  if (/color|background|accent|palette/i.test(key)) return "Colors";
  if (/font|typography|typeface/i.test(key)) return "Typography";
  if (/layout|width|header|footer|navigation|spacing|columns/i.test(key)) return "Layout";
  if (/show|visible|display|content|author|date|related/i.test(key)) return "Content";
  return "General";
}
function groupedThemeSettings(schema: Record<string, ApiThemeSettingDefinition>) {
  const groups: Record<string, Array<[string, ApiThemeSettingDefinition]>> = {};
  for (const [key, definition] of Object.entries(schema)) {
    const category = themeSettingCategory(key);
    (groups[category] ??= []).push([key, definition]);
  }
  return Object.entries(groups);
}

interface ThemeSettingsEditorProps {
  theme: ApiThemeSummary;
  onBack: () => void;
  onDirtyChange: (dirty: boolean) => void;
  onSaved: (settings: Record<string, unknown>) => void;
  onSavingChange?: (saving: boolean) => void;
}

export const ThemeSettingsEditor: React.FC<ThemeSettingsEditorProps> = ({
  theme,
  onBack,
  onDirtyChange,
  onSaved,
  onSavingChange,
}) => {
  const { tr } = useAdminLocale();
  const idPrefix = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [detail, setDetail] = useState<ApiThemeDetail | null>(null);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [initial, setInitial] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    onSavingChange?.(saving);
  }, [saving, onSavingChange]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setDetail(null);
    setError(null);
    setSuccess(false);
    getThemeApi(theme.manifest.id)
      .then((result) => {
        if (cancelled) return;
        const values = Object.fromEntries(
          Object.entries(result.settingsSchema).map(([key, definition]) => [
            key,
            result.settings?.[key] ?? definition.default,
          ]),
        );
        setDetail(result);
        setDraft(values);
        setInitial(values);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load theme settings.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [theme.manifest.id, retry]);

  const updateField = (key: string, value: unknown) => {
    setDraft((previous) => ({ ...previous, [key]: value }));
    setSuccess(false);
  };

  const save = async () => {
    if (!detail || saving || !dirty) return;
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      const result = await updateThemeSettingsApi(theme.manifest.id, draft, {
        themeVersion: detail.manifest.version,
        settingsSchemaVersion: detail.manifest.settingsSchemaVersion,
      });
      const values = result.theme.settings;
      setInitial(values);
      setDraft(values);
      setSuccess(true);
      onSaved(values);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save theme settings.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-label={`${tr("Theme settings for")} ${theme.manifest.name}`} className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Button size="sm" variant="outline" onClick={onBack} disabled={saving} aria-label={tr("Back to themes")}>
            <ArrowLeft className="h-4 w-4 rtl:rotate-180" />
          </Button>
          <div>
            <h4 ref={headingRef} tabIndex={-1} className="text-sm font-semibold text-foreground">{theme.manifest.name} {tr("Settings")}</h4>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {tr("Edit presentation options for this publication. Changes to inactive themes take effect on activation.")}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" className="min-h-11" disabled={!dirty || saving || loading}
            onClick={() => { setDraft({ ...initial }); setError(null); setSuccess(false); }}>
            {tr("Discard changes")}
          </Button>
        <Button size="sm" className="min-h-11" onClick={save} disabled={loading || saving || !dirty || !detail || Object.keys(detail.settingsSchema).length === 0}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {saving ? tr("Saving...") : tr("Save Settings")}
        </Button>
        </div>
      </div>

      {error && <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/20 p-3 text-sm text-destructive">
        <AlertCircle className="size-4 shrink-0" />{tr(error)}
        {!detail && !loading && <Button variant="outline" size="sm" className="min-h-11" onClick={() => setRetry((value) => value + 1)}>{tr("Retry")}</Button>}
      </div>}
      {success && <p role="status" className="flex gap-2 text-xs text-emerald-600"><CheckCircle2 className="h-4 w-4 shrink-0" />{tr("Theme settings saved.")}</p>}

      {loading ? (
        <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />{tr("Loading settings...")}
        </p>
      ) : detail && Object.keys(detail.settingsSchema).length === 0 ? (
        <p className="rounded-lg border border-border p-4 text-xs text-muted-foreground">
          {tr("This theme does not define any customizable fields in settings.json.")}
        </p>
      ) : detail ? (
        <div className="space-y-7">
          {groupedThemeSettings(detail.settingsSchema).map(([category, fields]) => (
            <section key={category} aria-label={tr(category)} className="space-y-4 rounded-xl border border-border/70 bg-card p-4 sm:p-5">
              <h5 className="border-b border-border/60 pb-3 text-base font-semibold text-foreground">{tr(category)}</h5>
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          {fields.map(([key, definition], index) => {
            const inputId = `${idPrefix}-${index}`;
            const descriptionId = `${inputId}-description`;
            const value = draft[key] ?? definition.default;
            const describedBy = definition.description ? descriptionId : undefined;
            return (
              <div key={key} className="space-y-1.5 min-w-0">
                <label htmlFor={inputId} className="block text-sm font-semibold text-foreground">
                  {tr(definition.label || themeFieldLabel(key))}
                </label>
                {definition.description && (
                  <p id={descriptionId} className="text-sm leading-relaxed text-muted-foreground">{tr(definition.description)}</p>
                )}
                {definition.type === "boolean" ? (
                  <input
                    id={inputId}
                    type="checkbox"
                    aria-describedby={describedBy}
                    disabled={saving}
                    checked={value === true}
                    onChange={(event) => updateField(key, event.target.checked)}
                    className="size-5 accent-primary"
                  />
                ) : definition.type === "select" ? (
                  <select
                    id={inputId}
                    aria-describedby={describedBy}
                    disabled={saving}
                    value={String(value ?? "")}
                    onChange={(event) => updateField(key, event.target.value)}
                    className="w-full min-h-11 rounded-md border border-border bg-card px-3 text-sm text-foreground"
                  >
                    {(definition.options || []).map((option) => {
                      const optionValue = typeof option === "string" ? option : option.value;
                      const optionLabel = typeof option === "string" ? option : option.label;
                      return <option key={optionValue} value={optionValue}>{tr(optionLabel)}</option>;
                    })}
                  </select>
                ) : definition.type === "color" ? (
                  <div className="flex items-center gap-2">
                    <input
                      id={inputId}
                      type="color"
                      title={tr("Choosing a color with this picker replaces its alpha value.")}
                      disabled={saving}
                      aria-label={`${tr("Choose")} ${tr(definition.label || themeFieldLabel(key))}`}
                      aria-describedby={describedBy}
                      value={toColorPickerHex(value)}
                      onChange={(event) => updateField(key, event.target.value)}
                      className="h-11 w-11 shrink-0 cursor-pointer"
                    />
                    <Input
                      aria-label={`${tr(definition.label || themeFieldLabel(key))} ${tr("hex value")}`}
                      aria-describedby={describedBy}
                      value={String(value ?? "")}
                      maxLength={9}
                      disabled={saving}
                      onChange={(event) => updateField(key, event.target.value)}
                      className="min-h-11 font-mono text-sm"
                    />
                  </div>
                ) : (
                  <Input
                    id={inputId}
                    type={definition.type === "number" ? "number" : "text"}
                    aria-describedby={describedBy}
                    disabled={saving}
                    min={definition.type === "number" ? definition.min : undefined}
                    max={definition.type === "number" ? definition.max : undefined}
                    maxLength={definition.type === "string" ? definition.maxLength : undefined}
                    value={String(value ?? "")}
                    onChange={(event) => updateField(
                      key,
                      definition.type === "number"
                        ? (event.target.value === "" ? "" : Number(event.target.value))
                        : event.target.value,
                    )}
                    className="min-h-11 text-sm"
                  />
                )}
              </div>
            );
          })}
              </div>
            </section>
          ))}
        </div>
      ) : null}
    </section>
  );
};
