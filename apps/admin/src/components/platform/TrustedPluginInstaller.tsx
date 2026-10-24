import { useEffect, useRef, useState } from "react";
import {
  type AdminOperatorPlugin,
  listOperatorTrustedPluginsApi,
  registerOperatorTrustedPluginApi,
} from "../../lib/api";
import { useAdminLocale } from "../../lib/admin-locale";
import { Button } from "../ui/button";

/**
 * Operator-only registration of artifacts already approved outside Vibress.
 * This UI never accepts executable packages, URLs, signatures, or migrations.
 * Registration does not activate the plugin or enable any publication.
 */
export function TrustedPluginInstaller({
  installedIds,
  onRegistered,
  onClose,
}: {
  installedIds: readonly string[];
  onRegistered: () => Promise<void>;
  onClose: () => void;
}) {
  const { tr } = useAdminLocale();
  const heading = useRef<HTMLHeadingElement>(null);
  const registeringRef = useRef(false);
  const [approved, setApproved] = useState<AdminOperatorPlugin[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    heading.current?.focus();
    let canceled = false;
    void listOperatorTrustedPluginsApi()
      .then((result) => { if (!canceled) setApproved(result.plugins); })
      .catch(() => { if (!canceled) setError(tr("Unable to load approved plugins.")); })
      .finally(() => { if (!canceled) setLoading(false); });
    return () => { canceled = true; };
  }, [tr]);

  const available = approved.filter((item) => !installedIds.includes(item.id));
  const selected = available.find((item) => item.id === selectedId);
  const register = async () => {
    if (!selected || !selected.approvalId || !Array.isArray(selected.capabilities) ||
        !acknowledged || loading || submitting || registeringRef.current) return;
    registeringRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      await registerOperatorTrustedPluginApi(selected.id, selected.approvalId);
      await onRegistered();
      onClose();
    } catch {
      // Backend errors can contain operator paths; avoid showing raw messages.
      setError(tr("Unable to register approved plugin."));
    } finally {
      registeringRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <section aria-labelledby="trusted-installer-title" className="rounded-lg border border-border bg-card p-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1 min-w-0">
          <h2 id="trusted-installer-title" tabIndex={-1} ref={heading}
            className="text-sm font-semibold focus:outline-none">
            {tr("Add Plugin")}
          </h2>
          <p className="text-xs text-muted-foreground">
            {tr("Only operator-approved releases can be registered. Registration does not activate plugins or enable publications.")}
          </p>
        </div>
        <Button type="button" variant="outline" size="xs" onClick={onClose}
          disabled={submitting}>{tr("Close")}</Button>
      </div>

      <p className="text-xs text-muted-foreground">
        {tr("ZIP uploads and GitHub URLs require offline operator review, artifact integrity checks, and migration approval. They cannot be installed directly in Studio.")}
      </p>

      <p className="text-xs text-muted-foreground">
        {tr("Trusted plugins run with Node.js process privileges; signature verification is not sandbox isolation.")}
      </p>

      {loading && <p role="status" className="text-xs text-muted-foreground">{tr("Loading approved plugins...")}</p>}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      {!loading && !error && available.length === 0 && (
        <p role="status" className="text-xs text-muted-foreground">{tr("No operator-approved plugins available.")}</p>
      )}

      {!loading && available.length > 0 && (
        <fieldset className="space-y-2" disabled={submitting}>
          <legend className="text-xs font-semibold mb-2">{tr("Choose approved plugin")}</legend>
          {available.map((item) => (
            <label key={item.id} className="flex gap-3 rounded-md border border-border p-3 cursor-pointer has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
              <input type="radio" name="operator-approved-plugin"
                value={item.id} checked={selectedId === item.id}
                onChange={() => { setSelectedId(item.id); setAcknowledged(false); }}
                className="mt-0.5 shrink-0 accent-primary" />
              <span className="min-w-0 space-y-1">
                <span className="block text-xs font-semibold break-words" dir="auto">{item.name}</span>
                <span className="block text-xs text-muted-foreground">
                  {tr("Operator approved — integrity verification required before registration")}
                </span>
                <span className="block text-xs text-muted-foreground break-all" dir="auto">{item.id} · {item.version}</span>
                {!item.approvalId && (
                  <span className="block text-xs text-destructive">
                    {tr("Immutable release identity unavailable: registration requires an updated server.")}
                  </span>
                )}
                {item.description && <span className="block text-xs text-muted-foreground" dir="auto">{item.description}</span>}
                <span className="block text-xs text-muted-foreground">{tr("Requested capabilities")}</span>
                <span className="block text-xs break-words" dir="auto">
                  {!Array.isArray(item.capabilities)
                    ? tr("Capabilities unavailable: registration requires a newer server.")
                    : item.capabilities.length > 0 ? item.capabilities.join(", ") : tr("None")}
                </span>
                {item.release && (
                  <span className="block text-xs text-muted-foreground space-y-1">
                    <span className="block" dir="auto">
                      {tr("Publisher")}: {item.release.publisher.name}
                    </span>
                    <span className="block break-all" dir="ltr">
                      {tr("Release ID")}: {item.release.releaseId}
                    </span>
                    <span className="block" dir="auto">
                      {tr("Host ABI")}: {item.release.compatibility.sdkAbiVersion}
                    </span>
                    <span className="block">
                      {tr("SBOM pinned")}: {item.release.hasSbom ? tr("Yes") : tr("No")}
                      {" · "}
                      {tr("Provenance pinned")}: {item.release.hasProvenance ? tr("Yes") : tr("No")}
                    </span>
                    <span className="block">
                      {tr("Migration plans")}: {item.release.migrationPlanIds.length}
                    </span>
                  </span>
                )}
                <span className="block text-xs text-muted-foreground">
                  {item.signatureVerified === true
                    ? tr("Detached Ed25519 operator approval verified.")
                    : item.signatureVerified === false
                      ? tr("Legacy unsigned operator approval: no detached signature was verified.")
                      : tr("Operator signature status unavailable.")}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
      )}

      {selected && (
        <div className="space-y-3">
          <label className="flex items-start gap-2 text-xs">
            <input type="checkbox" checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
              disabled={submitting} className="mt-0.5 shrink-0 accent-primary" />
            <span>{tr("I have reviewed the approved plugin and its requested capabilities. Installation and schema migrations remain operator-controlled.")}</span>
          </label>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
              {tr("Cancel")}
            </Button>
            <Button type="button" onClick={() => { void register(); }}
              disabled={!selected.approvalId || !Array.isArray(selected.capabilities) || !acknowledged || submitting}>
              {submitting ? tr("Registering plugin...") : tr("Register trusted plugin")}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
