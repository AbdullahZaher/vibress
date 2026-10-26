import { useEffect, useState } from "react";
import type { ExtensionNativeDomainWorkflowV1, ExtensionNativeDataPageV1 } from "@vibress/api-contracts";
import { writeExtensionAdminViewApi, type AdminExtensionViewLink } from "../../lib/api";
import { getActivePublicationId } from "../../lib/api/client";
import { useAdminLocale } from "../../lib/admin-locale";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

type Item = ExtensionNativeDataPageV1["items"][number];
type Draft = { kind: "create" | "edit"; id: string; version: number; fields: Record<string, string> };
const COURSE_ID = /^[a-z][a-z0-9-]{1,63}$/;

/** An inert form bound to an existing Host-authorized Admin POST.
 * Business invariants and publication isolation remain in the plugin handler.
 * Never substitute the generic storage mutation API for a domain workflow. */
export function NativeExtensionDomainEditor({ link, workflow, publicationId, selected, onClear, onSaved }: {
  link: AdminExtensionViewLink; workflow: ExtensionNativeDomainWorkflowV1;
  publicationId: string | null; selected: Item | null;
  onClear: () => void; onSaved: () => void;
}) {
  const { tr, locale } = useAdminLocale();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [initial, setInitial] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    setSaving(false); setError(""); setNotice("");
    if (!selected) { setDraft(null); setInitial(null); return; }
    const fields: Record<string, string> = {};
    for (const field of workflow.fields) {
      const value = selected.fields[field.key];
      fields[field.key] = typeof value === "string" ? value : "";
    }
    const next: Draft = { kind: "edit", id: selected.id, version: selected.version, fields };
    setDraft(next); setInitial(next);
  }, [link.pluginId, link.viewId, publicationId, selected?.id, selected?.version, workflow]);
  const dirty = !!draft && !!initial && (draft.id !== initial.id ||
    JSON.stringify(draft.fields) !== JSON.stringify(initial.fields));
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault(); event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  function close() { setDraft(null); setInitial(null); onClear(); }
  function cancel() {
    if (dirty && !window.confirm(tr("Discard unsaved plugin changes?"))) return;
    close();
  }
  async function submit(operation: "create" | "save" | "publish") {
    if (!draft || saving || getActivePublicationId() !== publicationId ||
        !workflow.operations.includes(operation) || workflow.routeId !== link.routeId) return;
    if (!COURSE_ID.test(draft.id) ||
        (operation === "create" ? draft.kind !== "create" : draft.kind !== "edit")) {
      setError(tr("Invalid plugin record data.")); return;
    }
    if (operation === "publish" && (dirty ||
        workflow.fields.some((field) => !draft.fields[field.key]?.trim()))) {
      setError(tr("Save your changes before publishing.")); return;
    }
    const body: Record<string, string | number | boolean> = {
      [workflow.idField]: draft.id,
      [workflow.versionField]: draft.version,
      [workflow.operationField]: operation,
    };
    for (const field of workflow.fields) {
      const value = draft.fields[field.key] ?? "";
      if (value.length > field.maxLength) {
        setError(tr("Invalid plugin record data.")); return;
      }
      body[field.key] = value;
    }
    if (!window.confirm(operation === "publish"
      ? tr("Confirm publish this record?") : tr("Confirm saving this draft?"))) return;
    setSaving(true); setError(""); setNotice("");
    try {
      const result = await writeExtensionAdminViewApi(link, body);
      if (getActivePublicationId() !== publicationId) return;
      const expected = operation === "create" ? "created" :
        operation === "save" ? "saved" : "published";
      if (result.outcome !== expected || result[workflow.idField] !== draft.id ||
          typeof result.version !== "number" || result.version <= draft.version) {
        setError(tr("Workflow action rejected.")); return;
      }
      close();
      setNotice(operation === "publish"
        ? tr("Course published successfully.") : tr("Draft saved successfully."));
      onSaved();
    } catch {
      if (getActivePublicationId() === publicationId) setError(tr("Workflow action failed."));
    } finally {
      if (getActivePublicationId() === publicationId) setSaving(false);
    }
  }

  if (getActivePublicationId() !== publicationId) return null;
  if (workflow.routeId !== link.routeId) return <p role="alert">{tr("Workflow action rejected.")}</p>;
  const published = selected?.fields.status === "published";
  const prefix = "domain-" + link.pluginId + "-" + workflow.viewId;
  return <section aria-label={tr("Domain workflow")} className="space-y-3">
    {notice && <p role="status" className="text-sm">{notice}</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {!draft && workflow.operations.includes("create") && <Button type="button" size="sm" onClick={() => {
      const fields = Object.fromEntries(workflow.fields.map((field) => [field.key, ""]));
      const next: Draft = { kind: "create", id: "", version: 0, fields };
      setDraft(next); setInitial(next); setError(""); setNotice("");
    }}>{tr("Create draft")}</Button>}
    {published && <p role="status">{tr("Published items cannot be edited.")}</p>}
    {draft && !(draft.kind === "edit" && published) && <form
      className="space-y-3 border-t border-border pt-3"
      onSubmit={(event) => { event.preventDefault(); void submit(draft.kind === "create" ? "create" : "save"); }}>
      <div>
        <label htmlFor={prefix + "-id"} className="block text-xs mb-1">{tr("Record ID")}</label>
        <Input id={prefix + "-id"} dir="ltr" autoComplete="off" required maxLength={64}
          disabled={saving || draft.kind === "edit"} value={draft.id}
          onChange={(event) => setDraft((prev) => prev ? { ...prev, id: event.target.value } : prev)} />
      </div>
      <div className="grid grid-cols-1 gap-3">
        {workflow.fields.map((field) => {
          const id = prefix + "-" + field.key;
          const value = draft.fields[field.key] ?? "";
          const update = (next: string) => setDraft((prev) =>
            prev ? { ...prev, fields: { ...prev.fields, [field.key]: next } } : prev);
          return <div key={field.key} className="space-y-1">
            <label htmlFor={id} dir="auto" className="block text-xs font-medium">{field.label[locale]}</label>
            {field.multiline ? <textarea id={id} dir="auto" rows={field.maxLength > 1500 ? 6 : 3}
              className="w-full rounded-md border border-border bg-background p-2 text-sm"
              maxLength={field.maxLength} disabled={saving} value={value}
              onChange={(event) => update(event.target.value)} />
              : <Input id={id} dir="auto" autoComplete="off" maxLength={field.maxLength}
                disabled={saving} value={value} onChange={(event) => update(event.target.value)} />}
          </div>;
        })}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={saving}>
          {tr(draft.kind === "create" ? "Create draft" : "Save draft")}
        </Button>
        {draft.kind === "edit" && workflow.operations.includes("publish") && <Button
          type="button" variant="outline" disabled={saving || dirty}
          onClick={() => { void submit("publish"); }}>{tr("Publish")}</Button>}
        <Button type="button" variant="outline" disabled={saving} onClick={cancel}>{tr("Cancel")}</Button>
      </div>
    </form>}
    {published && selected && <Button type="button" size="sm" variant="outline"
      onClick={cancel}>{tr("Cancel")}</Button>}
  </section>;
}
