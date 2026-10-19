import { useEffect, useState } from "react";
import type { AdminPlugin, AdminScopedPluginSetting } from "../../lib/api";
import {
  listPluginPublicationSettingsApi,
  setPluginPublicationSettingsApi,
} from "../../lib/api";
import { useAdminLocale } from "../../lib/admin-locale";
import { Button } from "../ui/button";

type StringSettingField = { key: string; label: string; secret: boolean };

function declaredStringFields(schema: Record<string, unknown> | undefined): StringSettingField[] {
  if (!schema) return [];
  const source: unknown = Object.hasOwn(schema, "properties") ? schema.properties : schema;
  if (!source || typeof source !== "object" || Array.isArray(source)) return [];
  return Object.entries(source).flatMap(([key, definition]) => {
    if (!/^[a-zA-Z][a-zA-Z0-9_.-]{0,99}$/.test(key) ||
      !definition || typeof definition !== "object" || Array.isArray(definition) ||
      !("type" in definition) || definition.type !== "string") return [];
    return [{
      key,
      label: "title" in definition && typeof definition.title === "string"
        ? definition.title : key,
      secret: "secret" in definition && definition.secret === true,
    }];
  });
}

interface Props {
  plugin: AdminPlugin;
  onError: (message: string) => void;
}

/** Configures only the currently authoritative Staff publication. */
export function ScopedPluginSettingsEditor({ plugin, onError }: Props) {
  const { tr } = useAdminLocale();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<AdminScopedPluginSetting[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState(false);
  const fields = declaredStringFields(plugin.settingsSchema);

  useEffect(() => {
    // Switching publications must never preserve the previous site's secret
    // edit state, saved values or form visibility.
    const reset = () => {
      setOpen(false);
      setSaved([]);
      setDraft({});
      setSuccess(false);
    };
    window.addEventListener("vibress:publication-changed", reset);
    return () => window.removeEventListener("vibress:publication-changed", reset);
  }, []);

  useEffect(() => {
    if (!open) return;
    let canceled = false;
    setLoading(true);
    void listPluginPublicationSettingsApi(plugin.id)
      .then((response) => { if (!canceled) setSaved(response.settings); })
      .catch(() => { if (!canceled) onError(tr("Settings loading failed")); })
      .finally(() => { if (!canceled) setLoading(false); });
    return () => { canceled = true; };
  }, [open, plugin.id]);

  if (fields.length === 0) return null;
  const save = async () => {
    if (saving || Object.keys(draft).length === 0) return;
    setSaving(true);
    setSuccess(false);
    try {
      await setPluginPublicationSettingsApi(plugin.id, draft);
      const response = await listPluginPublicationSettingsApi(plugin.id);
      setSaved(response.settings);
      setDraft({});
      setSuccess(true);
    } catch (error: unknown) {
      onError(error instanceof Error ? error.message : tr("Plugin action failed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="space-y-2" aria-label={tr("Plugin settings")}>
      <Button
        variant="outline"
        size="sm"
        disabled={saving}
        onClick={() => { setOpen(!open); setDraft({}); setSuccess(false); }}
        aria-expanded={open}
        aria-controls={`plugin-settings-${plugin.id}`}
      >
        {tr("Edit publication settings")}
      </Button>
      {open && (
        <div id={`plugin-settings-${plugin.id}`} className="space-y-3 pt-2">
          {loading && <p className="text-xs" role="status">{tr("Loading settings...")}</p>}
          {!loading && fields.map((field) => {
            const stored = saved.find((setting) => setting.key === field.key);
            const id = `plugin-setting-${plugin.id}-${field.key}`;
            const currentValue = draft[field.key] ?? (field.secret ? "" : stored?.value ?? "");
            return (
              <div key={field.key} className="space-y-1">
                <label htmlFor={id} className="text-xs font-medium" dir="auto">
                  {field.label}
                </label>
                <input
                  id={id}
                  type={field.secret ? "password" : "text"}
                  autoComplete="off"
                  maxLength={4096}
                  disabled={saving}
                  value={currentValue}
                  placeholder={field.secret && stored?.masked ? "••••••••" : undefined}
                  aria-description={field.secret ? tr("Secret (leave blank to keep)") : undefined}
                  onChange={(event) => {
                    setSuccess(false);
                    setDraft((previous) => ({ ...previous, [field.key]: event.target.value }));
                  }}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
                  dir="auto"
                />
                {field.secret && (
                  <p className="text-xs text-muted-foreground">
                    {tr("Secret (leave blank to keep)")}
                  </p>
                )}
              </div>
            );
          })}
          {success && <p role="status" className="text-xs text-emerald-600">{tr("Settings saved")}</p>}
          <Button
            variant="outline"
            size="sm"
            disabled={saving || loading || Object.keys(draft).length === 0}
            onClick={() => { void save(); }}
          >
            {tr("Save plugin settings")}
          </Button>
        </div>
      )}
    </section>
  );
}
