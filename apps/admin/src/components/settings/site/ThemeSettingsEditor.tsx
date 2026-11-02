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
import { AlertCircle, ArrowLeft, CheckCircle2, Loader2, RotateCcw, Save } from "lucide-react";

import { isValidHexColor, validateSettingValue } from "@vibress/theme-core";
export { isValidHexColor };

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

/** Validates an individual setting against its schema definition using shared theme-core contracts. */
export function validateThemeSetting(
  definition: ApiThemeSettingDefinition,
  value: unknown,
  tr: (s: string) => string,
): string | null {
  const isOptional = (definition as { optional?: boolean }).optional === true;
  const isDefined = value !== undefined && value !== null;
  const stringVal = isDefined ? String(value).trim() : "";

  // Handle empty or unentered values
  if (!isDefined || stringVal === "") {
    if (isOptional) return null;
    if (definition.type === "color") {
      return tr("A valid HEX color is required.");
    }
    if (definition.type === "number") {
      return tr("Please enter a valid number.");
    }
    if (definition.type === "string") {
      const isRequired = (definition as { required?: boolean }).required === true;
      if (isRequired) return tr("This field is required.");
      const minLength = (definition as { minLength?: number }).minLength;
      if (minLength !== undefined && minLength > 0) {
        return `${tr("Minimum length is")} ${minLength}`;
      }
      return null;
    }
  }

  // Parse string representation of numbers from input fields before validating against schema
  const parsedValue =
    definition.type === "number" && typeof value === "string"
      ? (stringVal === "" ? NaN : Number(value))
      : value;

  const result = validateSettingValue("setting", definition as any, parsedValue);
  if (result.ok) return null;

  if (definition.type === "color") {
    return tr("Invalid HEX format. Use #RGB, #RGBA, #RRGGBB, or #RRGGBBAA.");
  }
  if (definition.type === "number") {
    if (result.error.includes("below min")) {
      return `${tr("Value must be at least")} ${definition.min}`;
    }
    if (result.error.includes("above max")) {
      return `${tr("Value must be at most")} ${definition.max}`;
    }
    return tr("Please enter a valid number.");
  }
  if (definition.type === "string") {
    if (result.error.includes("string length must be at least")) {
      return `${tr("Minimum length is")} ${(definition as any).minLength}`;
    }
    if (result.error.includes("string exceeds max length")) {
      return `${tr("Maximum length is")} ${definition.maxLength}`;
    }
    return result.error;
  }
  if (definition.type === "select") {
    return tr("Please select a valid option.");
  }
  return result.error;
}

/** Schema keys may be camelCase; the UI must not show raw implementation identifiers. */
export function themeFieldLabel(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/** Groups only actual schema-defined settings; no fabricated design controls. */
export function themeSettingCategory(key: string): string {
  if (/color|background|accent|palette/i.test(key)) return "Colors";
  if (/font|typography|typeface/i.test(key)) return "Typography";
  // Dimensions and styles are layout even when their name includes "content".
  if (/width|layout|headerStyle|footerStyle|navigation|spacing|columns|align|sidebar/i.test(key)) return "Layout";
  // Footer text, content visibility and copy belong to content, not layout.
  if (/show|visible|display|content|author|date|related|cover|excerpt|tagline|description|copyright|bio|footer.*text|header.*text|social/i.test(key)) return "Content";
  if (/header|footer/i.test(key)) return "Layout";
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
  const [lastValidColors, setLastValidColors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const changedKeys = detail
    ? Object.keys(detail.settingsSchema).filter((key) => JSON.stringify(draft[key]) !== JSON.stringify(initial[key]))
    : [];
  const colorFields = detail ? Object.entries(detail.settingsSchema)
    .filter(([, definition]) => definition.type === "color")
    .slice(0, 6) : [];

  const fieldErrors: Record<string, string> = {};
  if (detail) {
    for (const [key, definition] of Object.entries(detail.settingsSchema)) {
      const err = validateThemeSetting(definition, draft[key] ?? definition.default, tr);
      if (err) fieldErrors[key] = err;
    }
  }
  const hasErrors = Object.keys(fieldErrors).length > 0;

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
        const validColors: Record<string, string> = {};
        for (const [key, definition] of Object.entries(result.settingsSchema)) {
          if (definition.type === "color" && isValidHexColor(values[key])) {
            validColors[key] = String(values[key]).trim();
          }
        }
        setDetail(result);
        setDraft(values);
        setInitial(values);
        setLastValidColors(validColors);
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
    if (isValidHexColor(value)) {
      setLastValidColors((previous) => ({ ...previous, [key]: String(value).trim() }));
    }
    setSuccess(false);
  };

  const handleColorPickerChange = (key: string, newHex6: string) => {
    const previous = String(draft[key] ?? "");
    let finalHex = newHex6;
    if (/^#[0-9a-fA-F]{8}$/.test(previous)) {
      finalHex = `${newHex6}${previous.slice(7, 9)}`;
    } else if (/^#[0-9a-fA-F]{4}$/.test(previous)) {
      finalHex = `${newHex6}${previous[4]}${previous[4]}`;
    }
    updateField(key, finalHex);
  };

  const save = async () => {
    if (!detail || saving || !dirty || hasErrors) return;
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      const payload: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(draft)) {
        const def = detail.settingsSchema[key];
        if (def?.type === "number" && typeof val === "string" && val.trim() !== "") {
          payload[key] = Number(val);
        } else if (def?.type === "color" && typeof val === "string") {
          payload[key] = val.trim();
        } else {
          payload[key] = val;
        }
      }
      const result = await updateThemeSettingsApi(theme.manifest.id, payload, {
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
    <section aria-label={`${tr("Theme settings for")} ${theme.manifest.name}`} className="space-y-6 pb-4">
      {/* Sticky action bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-4 lg:sticky lg:top-0 lg:z-10 lg:rounded-2xl lg:border lg:border-border/80 lg:bg-card/95 lg:p-4 lg:shadow-xs lg:backdrop-blur-md">
        <div className="flex min-w-0 items-center gap-3">
          <Button size="sm" variant="outline" className="min-h-11 min-w-11 rounded-xl" onClick={onBack} disabled={saving} aria-label={tr("Back to themes")}>
            <ArrowLeft className="h-4 w-4 rtl:rotate-180" />
          </Button>
          <div className="min-w-0">
            <h4 ref={headingRef} tabIndex={-1} className="text-base sm:text-lg font-bold tracking-tight text-foreground outline-none">
              {theme.manifest.name} {tr("Settings")}
            </h4>
            <p className="text-xs sm:text-sm leading-relaxed text-muted-foreground">
              {tr("Edit presentation options for this publication. Changes to inactive themes take effect on activation.")}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {hasErrors && (
            <span className="text-xs text-destructive font-medium">
              {tr("Fix validation errors before saving.")}
            </span>
          )}
          <Button size="sm" variant="outline" className="min-h-11 rounded-xl font-medium" disabled={!dirty || saving || loading}
            onClick={() => {
              setDraft({ ...initial });
              const validColors: Record<string, string> = {};
              if (detail) {
                for (const [key, definition] of Object.entries(detail.settingsSchema)) {
                  if (definition.type === "color" && isValidHexColor(initial[key])) {
                    validColors[key] = String(initial[key]).trim();
                  }
                }
              }
              setLastValidColors(validColors);
              setError(null);
              setSuccess(false);
            }}>
            <RotateCcw className="size-3.5 me-1 text-muted-foreground" />
            {tr("Discard changes")}
          </Button>
          <Button size="sm" className="min-h-11 rounded-xl font-semibold shadow-xs" onClick={save} disabled={loading || saving || !dirty || !detail || Object.keys(detail.settingsSchema).length === 0 || hasErrors}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saving ? tr("Saving...") : tr("Save Settings")}
          </Button>
        </div>
      </div>

      {error && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive shadow-xs">
          <div className="flex items-center gap-2.5">
            <AlertCircle className="size-4 shrink-0" />
            <span>{tr(error)}</span>
          </div>
          {!detail && !loading && (
            <Button variant="outline" size="sm" className="min-h-11 rounded-xl" onClick={() => setRetry((value) => value + 1)}>
              {tr("Retry")}
            </Button>
          )}
        </div>
      )}

      {success && (
        <p role="status" className="flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3.5 text-sm font-medium text-emerald-800 dark:text-emerald-300 shadow-xs">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
          {tr("Theme settings saved.")}
        </p>
      )}

      {loading ? (
        <div role="status" className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
          <p className="text-sm font-medium">{tr("Loading settings...")}</p>
        </div>
      ) : detail && Object.keys(detail.settingsSchema).length === 0 ? (
        <div className="rounded-2xl border border-border/80 bg-muted/10 p-8 text-center text-sm text-muted-foreground">
          {tr("This theme does not define any customizable fields in settings.json.")}
        </div>
      ) : detail ? (
        <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1.55fr)_minmax(18rem,0.85fr)]">
          <div className="min-w-0 space-y-6">
            {groupedThemeSettings(detail.settingsSchema).map(([category, fields]) => (
              <section key={category} aria-label={tr(category)} className="space-y-5 rounded-2xl border border-border/80 bg-card p-5 sm:p-6 shadow-xs">
                <div className="border-b border-border/60 pb-3">
                  <h5 className="text-base font-bold tracking-tight text-foreground">{tr(category)}</h5>
                </div>
                <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                  {fields.map(([key, definition]) => {
                    const inputId = `${idPrefix}-${Object.keys(detail.settingsSchema).indexOf(key)}`;
                    const descriptionId = `${inputId}-description`;
                    const errorId = `${inputId}-error`;
                    const value = draft[key] ?? definition.default;
                    const fieldError = fieldErrors[key];
                    const isInvalid = Boolean(fieldError);
                    const describedBy = [
                      definition.description ? descriptionId : null,
                      isInvalid ? errorId : null,
                    ].filter(Boolean).join(" ") || undefined;
                    const isColorType = definition.type === "color";
                    const isColorValid = isColorType ? isValidHexColor(value) : true;
                    return (
                      <div key={key} className="min-w-0 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <label htmlFor={isColorType ? `${inputId}-text` : inputId} className="block text-sm font-semibold text-foreground">
                            {tr(definition.label || themeFieldLabel(key))}
                          </label>
                          {definition.type === "string" && definition.maxLength && (
                            <span className="font-mono text-[11px] text-muted-foreground">
                              {String(value ?? "").length}/{definition.maxLength}
                            </span>
                          )}
                        </div>

                        {definition.description && (
                          <p id={descriptionId} className="text-xs sm:text-sm leading-relaxed text-muted-foreground">
                            {tr(definition.description)}
                          </p>
                        )}

                        {definition.type === "boolean" ? (
                          <div className="flex items-center gap-3 pt-1">
                            <input
                              id={inputId}
                              type="checkbox"
                              aria-describedby={describedBy}
                              disabled={saving}
                              checked={value === true}
                              onChange={(event) => updateField(key, event.target.checked)}
                              className="size-5 rounded border-border accent-primary focus-visible:ring-2 focus-visible:ring-ring cursor-pointer"
                            />
                            <span className="text-sm font-medium text-foreground/80">
                              {value === true ? tr("Enabled") : tr("Disabled")}
                            </span>
                          </div>
                        ) : definition.type === "select" ? (
                          <select
                            id={inputId}
                            aria-describedby={describedBy}
                            disabled={saving}
                            value={String(value ?? "")}
                            onChange={(event) => updateField(key, event.target.value)}
                            className="w-full min-h-11 rounded-xl border border-border bg-card px-3.5 text-sm text-foreground shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            {(definition.options || []).map((option) => {
                              const optionValue = typeof option === "string" ? option : option.value;
                              const optionLabel = typeof option === "string" ? option : option.label;
                              return <option key={optionValue} value={optionValue}>{tr(optionLabel)}</option>;
                            })}
                          </select>
                        ) : isColorType ? (
                          <div className="space-y-1.5">
                            <div className="flex items-center gap-2">
                              <input
                                id={inputId}
                                type="color"
                                title={tr("Choose color (transparency is preserved).")}
                                disabled={saving}
                                aria-label={`${tr("Choose")} ${tr(definition.label || themeFieldLabel(key))}`}
                                aria-describedby={describedBy}
                                value={toColorPickerHex(isColorValid ? value : (lastValidColors[key] ?? initial[key] ?? definition.default ?? "#000000"))}
                                onChange={(event) => handleColorPickerChange(key, event.target.value)}
                                className="size-11 shrink-0 cursor-pointer rounded-xl border border-border bg-card p-1 shadow-xs"
                              />
                              <Input
                                id={`${inputId}-text`}
                                type="text"
                                aria-label={`${tr(definition.label || themeFieldLabel(key))} ${tr("hex value")}`}
                                aria-describedby={describedBy}
                                aria-invalid={isInvalid ? "true" : undefined}
                                value={String(value ?? "")}
                                maxLength={9}
                                disabled={saving}
                                onChange={(event) => updateField(key, event.target.value)}
                                className={"min-h-11 rounded-xl font-mono text-sm shadow-xs " +
                                  (isInvalid ? "border-destructive focus-visible:ring-destructive" : "")}
                              />
                            </div>
                            {isInvalid && (
                              <p id={errorId} role="alert" className="flex items-center gap-1.5 text-xs text-destructive">
                                <AlertCircle className="size-3.5 shrink-0" />
                                <span>{fieldError}</span>
                              </p>
                            )}
                          </div>
                        ) : (
                          <div className="space-y-1">
                            <Input
                              id={inputId}
                              type={definition.type === "number" ? "number" : "text"}
                              aria-describedby={describedBy}
                              aria-invalid={isInvalid ? "true" : undefined}
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
                              className={"min-h-11 rounded-xl text-sm shadow-xs " +
                                (isInvalid ? "border-destructive focus-visible:ring-destructive" : "")}
                            />
                            {isInvalid && (
                              <p id={errorId} role="alert" className="flex items-center gap-1.5 text-xs text-destructive">
                                <AlertCircle className="size-3.5 shrink-0" />
                                <span>{fieldError}</span>
                              </p>
                            )}
                            {definition.type === "number" && (definition.min !== undefined || definition.max !== undefined) && (
                              <p className="text-xs text-muted-foreground font-mono">
                                {definition.min !== undefined && definition.max !== undefined
                                  ? `${tr("Range")}: ${definition.min} – ${definition.max}`
                                  : definition.min !== undefined
                                    ? `${tr("Minimum")}: ${definition.min}`
                                    : `${tr("Maximum")}: ${definition.max}`}
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>

          {/* Design changes overview panel */}
          <aside className="min-w-0 space-y-5 rounded-2xl border border-border/80 bg-muted/20 p-5 sm:p-6 shadow-xs xl:sticky xl:top-4"
            aria-label={tr("Design changes overview")}>
            <div className="space-y-1.5 border-b border-border/60 pb-3">
              <h5 className="text-base font-bold tracking-tight text-foreground">{tr("Design changes overview")}</h5>
              <p className="text-xs sm:text-sm leading-relaxed text-muted-foreground">
                {tr("This panel reflects field values only, not a live website preview. Save settings to preview the published rendering.")}
              </p>
            </div>

            {hasErrors && (
              <div role="alert" className="flex items-center gap-2 rounded-xl border border-destructive/20 bg-destructive/10 p-3 text-xs font-medium text-destructive">
                <AlertCircle className="size-4 shrink-0" />
                <span>{tr("Some settings require correction before saving.")}</span>
              </div>
            )}

            <div className="rounded-xl border border-border/80 bg-card p-4 shadow-xs" role="status">
              <p className="text-sm font-semibold text-foreground flex items-center justify-between">
                <span>{dirty ? tr("Unsaved changes") : tr("All changes saved")}</span>
                {dirty ? (
                  <span className="inline-flex size-6 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                    {changedKeys.length}
                  </span>
                ) : (
                  <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" />
                )}
              </p>
              {changedKeys.length > 0 && (
                <ul className="mt-3 space-y-2 border-t border-border/50 pt-2.5 text-xs sm:text-sm text-muted-foreground">
                  {changedKeys.map((key) => (
                    <li key={key} className="flex items-start gap-2">
                      <span aria-hidden="true" className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
                      <span className="break-words font-medium text-foreground/80">
                        {tr(detail.settingsSchema[key]?.label || themeFieldLabel(key))}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {colorFields.length > 0 && (
              <section aria-label={tr("Selected colors")} className="space-y-3 border-t border-border/60 pt-4">
                <h6 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{tr("Selected colors")}</h6>
                <div className="grid grid-cols-2 gap-3">
                  {colorFields.map(([key, definition]) => {
                    const rawVal = draft[key] ?? definition.default;
                    const valid = isValidHexColor(rawVal);
                    const swatchColor = valid
                      ? toColorPickerHex(rawVal)
                      : toColorPickerHex(lastValidColors[key] ?? initial[key] ?? definition.default ?? "#000000");
                    return (
                      <div key={key} className="min-w-0 space-y-1.5">
                        <div
                          className={"h-14 rounded-xl border shadow-xs transition-colors " +
                            (valid ? "border-border/80" : "border-destructive/60 ring-2 ring-destructive/20")}
                          aria-hidden="true"
                          style={{ backgroundColor: swatchColor }}
                        />
                        <p className="truncate text-xs font-semibold text-foreground">
                          {tr(definition.label || themeFieldLabel(key))}
                        </p>
                        <p className={"font-mono text-[11px] break-all " + (valid ? "text-muted-foreground" : "text-destructive font-medium")}>
                          {String(rawVal)}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {Object.keys(detail.settingsSchema).length > 0 && (
              <p className="border-t border-border/60 pt-3 text-xs leading-relaxed text-muted-foreground">
                {tr("Theme layout and script behavior must be checked in the full preview.")}
              </p>
            )}
          </aside>
        </div>
      ) : null}
    </section>
  );
};
