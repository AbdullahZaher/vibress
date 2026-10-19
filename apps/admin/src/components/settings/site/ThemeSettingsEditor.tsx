import React, { useEffect, useId, useState } from "react";
import {
  type ApiThemeDetail,
  type ApiThemeSummary,
  getThemeApi,
  updateThemeSettingsApi,
} from "../../../lib/api";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { AlertCircle, ArrowLeft, CheckCircle2, Loader2, Save } from "lucide-react";

interface ThemeSettingsEditorProps {
  theme: ApiThemeSummary;
  onBack: () => void;
  onDirtyChange: (dirty: boolean) => void;
  onSaved: (settings: Record<string, unknown>) => void;
}

export const ThemeSettingsEditor: React.FC<ThemeSettingsEditorProps> = ({
  theme,
  onBack,
  onDirtyChange,
  onSaved,
}) => {
  const idPrefix = useId();
  const [detail, setDetail] = useState<ApiThemeDetail | null>(null);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [initial, setInitial] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
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
  }, [theme.manifest.id]);

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
      const result = await updateThemeSettingsApi(theme.manifest.id, draft);
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
    <section aria-label={`Theme settings for ${theme.manifest.name}`} className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Button size="sm" variant="outline" onClick={onBack} aria-label="Back to themes">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h4 className="text-sm font-semibold text-foreground">{theme.manifest.name} Settings</h4>
            <p className="text-xs text-muted-foreground">
              Edit presentation options for this publication. Changes to inactive themes take effect on activation.
            </p>
          </div>
        </div>
        <Button size="sm" onClick={save} disabled={loading || saving || !dirty || !detail || Object.keys(detail.settingsSchema).length === 0}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {saving ? "Saving..." : "Save Settings"}
        </Button>
      </div>

      {error && <p role="alert" className="flex gap-2 text-xs text-red-600 dark:text-red-400"><AlertCircle className="h-4 w-4 shrink-0" />{error}</p>}
      {success && <p role="status" className="flex gap-2 text-xs text-emerald-600"><CheckCircle2 className="h-4 w-4 shrink-0" />Theme settings saved.</p>}

      {loading ? (
        <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />Loading settings...
        </p>
      ) : detail && Object.keys(detail.settingsSchema).length === 0 ? (
        <p className="rounded-lg border border-border p-4 text-xs text-muted-foreground">
          This theme does not define any customizable fields in settings.json.
        </p>
      ) : detail ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          {Object.entries(detail.settingsSchema).map(([key, definition]) => {
            const inputId = `${idPrefix}-${key}`;
            const descriptionId = `${inputId}-description`;
            const value = draft[key] ?? definition.default;
            const describedBy = definition.description ? descriptionId : undefined;
            return (
              <div key={key} className="space-y-1.5 min-w-0">
                <label htmlFor={inputId} className="block text-xs font-semibold text-foreground">
                  {definition.label || key}
                </label>
                {definition.description && (
                  <p id={descriptionId} className="text-xs text-muted-foreground">{definition.description}</p>
                )}
                {definition.type === "boolean" ? (
                  <input
                    id={inputId}
                    type="checkbox"
                    aria-describedby={describedBy}
                    checked={value === true}
                    onChange={(event) => updateField(key, event.target.checked)}
                    className="h-4 w-4 accent-primary"
                  />
                ) : definition.type === "select" ? (
                  <select
                    id={inputId}
                    aria-describedby={describedBy}
                    value={String(value ?? "")}
                    onChange={(event) => updateField(key, event.target.value)}
                    className="w-full h-9 rounded-md border border-border bg-card px-2 text-xs text-foreground"
                  >
                    {(definition.options || []).map((option) => {
                      const optionValue = typeof option === "string" ? option : option.value;
                      const optionLabel = typeof option === "string" ? option : option.label;
                      return <option key={optionValue} value={optionValue}>{optionLabel}</option>;
                    })}
                  </select>
                ) : definition.type === "color" ? (
                  <div className="flex items-center gap-2">
                    <input
                      id={inputId}
                      type="color"
                      aria-label={`Choose ${definition.label || key}`}
                      aria-describedby={describedBy}
                      value={/^#[0-9a-fA-F]{6}$/.test(String(value)) ? String(value) : "#000000"}
                      onChange={(event) => updateField(key, event.target.value)}
                      className="h-9 w-11 shrink-0 cursor-pointer"
                    />
                    <Input
                      aria-label={`${definition.label || key} hex value`}
                      aria-describedby={describedBy}
                      value={String(value ?? "")}
                      maxLength={9}
                      onChange={(event) => updateField(key, event.target.value)}
                      className="h-9 font-mono text-xs"
                    />
                  </div>
                ) : (
                  <Input
                    id={inputId}
                    type={definition.type === "number" ? "number" : "text"}
                    aria-describedby={describedBy}
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
                    className="h-9 text-xs"
                  />
                )}
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
};
