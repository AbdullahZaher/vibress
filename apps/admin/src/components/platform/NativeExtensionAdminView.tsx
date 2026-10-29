import { useCallback, useEffect, useRef, useState } from "react";
import type { ExtensionNativeAdminPageV1, ExtensionNativeDomainWorkflowV1 } from "@vibress/api-contracts";
import {
  type AdminExtensionViewLink,
  readExtensionAdminViewApi,
  readNativeExtensionAdminPageApi,
} from "../../lib/api";
import { getActivePublicationId } from "../../lib/api/client";
import { useAdminLocale } from "../../lib/admin-locale";
import { AdminPageHeader } from "../common/AdminPageHeader";
import { PluginAdminView } from "./PluginAdminView";
import { NativeExtensionResources } from "./NativeExtensionResources";

type Scalar = string | number | boolean;
type NativeState =
  | { kind: "loading" }
  | { kind: "legacy" }
  | { kind: "error" }
  | { kind: "native"; page: ExtensionNativeAdminPageV1;
      publicationId: string | null; pluginId: string; viewId: string; routeId: string;
      data: Record<string, Scalar>; workflow?: ExtensionNativeDomainWorkflowV1 };

const RECHECK_MS = 30_000;

/**
 * Host-only renderer. No HTML, script, CSS, JSX, URLs or callbacks from
 * extension metadata ever execute in the privileged Studio document.
 * Native admission and scalar reads remain separately Host-authorized.
 */
export function NativeExtensionAdminView({ link }: { link: AdminExtensionViewLink }) {
  const { locale, tr } = useAdminLocale();
  const [publicationRevision, setPublicationRevision] = useState(0);
  const [resumeRevision, setResumeRevision] = useState(0);
  // Remember Native admission for each specific Host view/publication, even
  // after a resource authorization failure has cleared the rendered page.
  const lastNativeIdentityRef = useRef<string | null>(null);
  // Resource/Staff denial is terminal for the current view + publication.
  // A separate Native/scalar request may still succeed after the resource
  // grant was revoked; it must not resurrect previously protected content.
  const deniedIdentityRef = useRef<string | null>(null);
  const [state, setState] = useState<NativeState>({ kind: "loading" });
  const onAuthorizationLost = useCallback(() => {
    deniedIdentityRef.current = JSON.stringify([
      link.pluginId, link.viewId, link.routeId, getActivePublicationId(),
    ]);
    setState({ kind: "error" });
  }, [link.pluginId, link.viewId, link.routeId]);

  useEffect(() => {
    const onPublicationChanged = () => setPublicationRevision((value) => value + 1);
    window.addEventListener("vibress:publication-changed", onPublicationChanged);
    return () => window.removeEventListener("vibress:publication-changed", onPublicationChanged);
  }, []);

  // Revalidate promptly when the operator returns to the Admin tab. Do not
  // expose cached values during the recheck, or silently downgrade a formerly
  // admitted Native page into a legacy frame after release revocation.
  useEffect(() => {
    const recheck = () => {
      setState({ kind: "loading" });
      setResumeRevision((revision) => revision + 1);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") recheck();
    };
    window.addEventListener("focus", recheck);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", recheck);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let pending = false;
    const publicationId = getActivePublicationId();
    const identity = JSON.stringify([link.pluginId, link.viewId, link.routeId, publicationId]);
    if (link.nativeProbeSupported !== true) {
      // Old API servers did not advertise the Native admission endpoint.
      // Preserve their separately authorized iframe/scalar behavior.
      setState({ kind: "legacy" });
      return;
    }
    setState({ kind: "loading" });
    const refresh = async () => {
      if (pending || cancelled) return;
      if (deniedIdentityRef.current === identity) {
        setState({ kind: "error" });
        return;
      }
      pending = true;
      try {
        const response = await readNativeExtensionAdminPageApi(link);
        if (cancelled || getActivePublicationId() !== publicationId) return;
        if (deniedIdentityRef.current === identity) {
          setState({ kind: "error" });
          return;
        }
        if (response.mode === "legacy") {
          // Only the Host explicitly decides a compatible legacy fallback.
          setState(lastNativeIdentityRef.current === identity
            ? { kind: "error" } : { kind: "legacy" });
          return;
        }
        const data = await readExtensionAdminViewApi(link);
        if (cancelled || getActivePublicationId() !== publicationId) return;
        if (deniedIdentityRef.current === identity) {
          setState({ kind: "error" });
          return;
        }
        lastNativeIdentityRef.current = identity;
        setState({
          kind: "native", page: response.page, publicationId, data,
          pluginId: link.pluginId, viewId: link.viewId, routeId: link.routeId,
          ...(response.workflow ? { workflow: response.workflow } : {}),
        });
      } catch {
        if (!cancelled) setState({ kind: "error" });
      } finally {
        pending = false;
      }
    };
    void refresh();
    const interval = window.setInterval(() => { void refresh(); }, RECHECK_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [link.pluginId, link.viewId, link.routeId, link.nativeProbeSupported, publicationRevision, resumeRevision]);

  if (state.kind === "legacy") return <PluginAdminView link={link} />;
  if (state.kind === "loading") {
    return <p role="status">{tr("Loading plugin view...")}</p>;
  }
  if (state.kind === "error") {
    return <p role="alert">{tr("Unable to load plugin view.")}</p>;
  }

  // Publication-change events can precede the effect that resets the view.
  // Fail closed during that render, never show the previous site's rows.
  if (getActivePublicationId() !== state.publicationId ||
      state.pluginId !== link.pluginId || state.viewId !== link.viewId ||
      state.routeId !== link.routeId) {
    return <p role="status">{tr("Loading plugin view...")}</p>;
  }

  const { page, data } = state;
  const text = (key: string) =>
    Object.hasOwn(data, key) ? String(data[key]) : "—";

  return (
    <section aria-label={page.title[locale]} className="w-full max-w-5xl mx-auto space-y-5">
      <AdminPageHeader
        title={<span dir="auto">{page.title[locale]}</span>}
        description={page.description ?
          <span dir="auto">{page.description[locale]}</span> : undefined}
      />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {page.components.map((component) => component.type === "stat" ? (
          <div key={component.id} className="rounded-xl border border-border p-4 space-y-2">
            <p className="text-xs text-muted-foreground" dir="auto">{component.label[locale]}</p>
            <p className="text-2xl font-semibold break-words" dir="auto">{text(component.field)}</p>
          </div>
        ) : (
          <div key={component.id} className="rounded-xl border border-border p-4">
            <dl className="divide-y divide-border">
              {component.fields.map((field) => (
                <div key={field.key} className="grid grid-cols-1 gap-1 py-2 sm:grid-cols-2">
                  <dt className="text-xs font-medium text-muted-foreground" dir="auto">
                    {field.label[locale]}
                  </dt>
                  <dd className="text-sm break-words" dir="auto">{text(field.key)}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
      <NativeExtensionResources pluginId={link.pluginId} viewId={link.viewId}
        publicationId={state.publicationId} link={link}
        onAuthorizationLost={onAuthorizationLost}
        {...(state.workflow ? { workflow: state.workflow } : {})} />
    </section>
  );
}
