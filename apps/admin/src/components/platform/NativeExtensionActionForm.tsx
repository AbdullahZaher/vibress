import { useEffect, useState, type FormEvent } from "react";
import type { ExtensionNativeDataDiscoveryV1, ExtensionNativeDataPageV1 } from "@vibress/api-contracts";
import { executeNativeExtensionActionApi } from "../../lib/api";
import { getActivePublicationId } from "../../lib/api/client";
import { useAdminLocale } from "../../lib/admin-locale";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

type Resource = ExtensionNativeDataDiscoveryV1["resources"][number];
type Action = ExtensionNativeDataDiscoveryV1["actions"][number];
type Item = ExtensionNativeDataPageV1["items"][number];
type Draft = { kind: "create" | "update"; id: string; version?: number; fields: Record<string, string> };
type Value = string | number | boolean | null;

/** No arbitrary plugin-defined code/URL; every save reauthorizes in the Host. */
export function NativeExtensionActionForm({ pluginId, publicationId, resource, actions, selected, onClear, onSaved }: {
  pluginId: string; publicationId: string | null; resource: Resource;
  actions: readonly Action[]; selected: Item | null;
  onClear: () => void; onSaved: () => void;
}) {
  const { tr } = useAdminLocale();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const hasCreate = actions.some((action) => action.resourceId === resource.id && action.operation === "create");

  useEffect(() => {
    setError(""); setNotice(""); setSaving(false);
    if (selected) {
      const fields: Record<string, string> = {};
      for (const key of resource.fields) {
        const value = selected.fields[key];
        if (value !== null && value !== undefined) fields[key] = String(value);
      }
      setDraft({ kind: "update", id: selected.id, version: selected.version, fields });
    } else {
      setDraft(null);
    }
  }, [pluginId, publicationId, resource.id, selected?.id, selected?.version]);

  function setField(key: string, value: string) {
    setDraft((prev) => prev ? { ...prev, fields: { ...prev.fields, [key]: value } } : prev);
  }
  function close() { setDraft(null); onClear(); }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || saving || getActivePublicationId() !== publicationId) return;
    const action = actions.find((entry) => entry.resourceId === resource.id && entry.operation === draft.kind);
    if (!action || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(draft.id)) {
      setError(tr("Invalid plugin record data.")); return;
    }
    const fields: Record<string, Value> = {};
    for (const key of resource.fields) {
      const raw = draft.fields[key] ?? "";
      if (!raw) {
        if (resource.requiredFields?.includes(key)) {
          setError(tr("Invalid plugin record data.")); return;
        }
        continue;
      }
      const type = resource.fieldTypes?.[key];
      if (type === "text" && raw.length <= 8192) fields[key] = raw;
      else if (type === "integer") {
        const num = Number(raw);
        if (!Number.isInteger(num) || num < -2147483648 || num > 2147483647) {
          setError(tr("Invalid plugin record data.")); return;
        }
        fields[key] = num;
      } else if (type === "boolean" && (raw === "true" || raw === "false")) {
        fields[key] = raw === "true";
      } else if (type === "timestamptz" &&
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(raw) &&
          Number.isFinite(Date.parse(raw))) fields[key] = raw;
      else { setError(tr("Invalid plugin record data.")); return; }
    }
    if (!Object.keys(fields).length) { setError(tr("Invalid plugin record data.")); return; }
    if (!window.confirm(tr("Confirm plugin record change?"))) return;
    setSaving(true); setError(""); setNotice("");
    try {
      await executeNativeExtensionActionApi(pluginId, action.id, {
        id: draft.id, ...(draft.kind === "update" ? { expectedVersion: draft.version } : {}), fields,
      });
      if (getActivePublicationId() !== publicationId) return;
      close();
      setNotice(tr("Plugin record saved."));
      onSaved();
    } catch {
      if (getActivePublicationId() === publicationId) setError(tr("Plugin action failed"));
    } finally {
      if (getActivePublicationId() === publicationId) setSaving(false);
    }
  }
  if (getActivePublicationId() !== publicationId) return null;
  const prefix = "plugin-record-" + pluginId + "-" + resource.id;
  return <section aria-label={tr("Plugin record editor")} className="space-y-3">
    {hasCreate && !draft && <Button type="button" size="sm" onClick={() => {
      setDraft({ kind: "create", id: "", fields: {} }); setError(""); setNotice("");
    }}>{tr("Create record")}</Button>}
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert" className="text-destructive text-sm">{error}</p>}
    {draft && <form onSubmit={(event) => { void submit(event); }} className="space-y-3 border-t border-border pt-3">
      <h3 className="font-medium">{tr(draft.kind === "create" ? "Create record" : "Edit record")}</h3>
      <div>
        <label className="block text-xs mb-1" htmlFor={prefix + "-id"}>{tr("Record ID")}</label>
        <Input id={prefix + "-id"} dir="ltr" required maxLength={128} autoComplete="off"
          disabled={saving || draft.kind === "update"} value={draft.id}
          onChange={(e) => setDraft((prev) => prev ? { ...prev, id: e.target.value } : prev)} />
      </div>
      {resource.fields.map((key) => {
        const type = resource.fieldTypes?.[key];
        const fieldId = prefix + "-" + key;
        return <div key={key} className="space-y-1">
          <label htmlFor={fieldId} dir="auto" className="block text-xs font-medium">{key}</label>
          {type === "boolean" ? (
            <select id={fieldId} value={draft.fields[key] ?? ""}
              required={resource.requiredFields?.includes(key)} disabled={saving}
              className="w-full h-9 rounded-md border border-border bg-background px-2 text-sm"
              onChange={(e) => setField(key, e.target.value)}>
              <option value="">—</option>
              <option value="true">{tr("True")}</option><option value="false">{tr("False")}</option>
            </select>
          ) : (
            <Input id={fieldId} type="text" dir="auto" autoComplete="off"
              inputMode={type === "integer" ? "numeric" : "text"}
              placeholder={type === "timestamptz" ? "2026-01-01T00:00:00Z" : undefined}
              maxLength={type === "integer" ? 11 : type === "timestamptz" ? 24 : 8192}
              required={resource.requiredFields?.includes(key)} disabled={saving}
              value={draft.fields[key] ?? ""} onChange={(e) => setField(key, e.target.value)} />
          )}
        </div>;
      })}
      <div className="flex gap-2">
        <Button type="submit" disabled={saving}>{tr("Save plugin record")}</Button>
        <Button type="button" variant="outline" disabled={saving} onClick={close}>{tr("Cancel")}</Button>
      </div>
    </form>}
  </section>;
}
