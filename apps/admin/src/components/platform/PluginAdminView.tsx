import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ExtensionAdminFrameProofSchema } from "@vibress/api-contracts";
import {
  ApiError, type AdminExtensionViewLink, issueExtensionAdminFrameTicketApi,
  readExtensionAdminFrameStatusApi, readExtensionAdminViewApi,
} from "../../lib/api";
import { getActivePublicationId } from "../../lib/api/client";
import { useAdminLocale } from "../../lib/admin-locale";
import { PluginAdminDataView } from "./PluginAdminDataView";
import { connectAdminExtensionReadBridge } from "../../lib/extensions/admin-bridge";

interface Props {
  link: AdminExtensionViewLink;
}

type FrameState =
  | { kind: "loading" }
  | { kind: "legacy" }
  | { kind: "error" }
  | { kind: "frame"; src: string; publicationId: string | null;
      bridgeNonce: string; sha256: string };

const REVOCATION_CHECK_MS = 30_000;

/**
 * Never transfer the MessagePort merely because iframe.onload fired.
 * Only server-injected, ticket-bound proof from the pinned HTML authorizes
 * the private linked-GET port. An unapproved redirect has no such proof.
 */
export function PluginAdminView({ link }: Props) {
  const { locale, tr } = useAdminLocale();
  const [publicationRevision, setPublicationRevision] = useState(0);
  const [frame, setFrame] = useState<FrameState>({ kind: "loading" });
  const frameRef = useRef<HTMLIFrameElement>(null);
  const closeBridgeRef = useRef<() => void>(() => undefined);
  const provedRef = useRef(false);
  const firstLoadRef = useRef(false);

  useEffect(() => {
    const onPublicationChanged = () => setPublicationRevision((n) => n + 1);
    window.addEventListener("vibress:publication-changed", onPublicationChanged);
    return () => window.removeEventListener("vibress:publication-changed", onPublicationChanged);
  }, []);

  useEffect(() => {
    let canceled = false;
    closeBridgeRef.current();
    provedRef.current = false;
    firstLoadRef.current = false;
    setFrame({ kind: "loading" });
    const publicationId = getActivePublicationId();
    void issueExtensionAdminFrameTicketApi(link).then(({ src, bridgeNonce, sha256 }) => {
      if (canceled) return;
      const prefix = `/api/admin/v1/extensions/${encodeURIComponent(link.pluginId)}/views/${encodeURIComponent(link.viewId)}/frame?ticket=`;
      const token = src.startsWith(prefix) ? src.slice(prefix.length) : "";
      if (!/^[a-f0-9]{64}$/.test(token) ||
          !/^[a-f0-9]{64}$/.test(bridgeNonce) ||
          !/^[a-f0-9]{64}$/.test(sha256)) {
        setFrame({ kind: "error" });
        return;
      }
      setFrame({ kind: "frame", src, publicationId, bridgeNonce, sha256 });
    }).catch((error: unknown) => {
      if (canceled) return;
      if (error instanceof ApiError && error.statusCode === 404) {
        setFrame({ kind: "legacy" });
      } else {
        setFrame({ kind: "error" });
      }
    });
    return () => {
      canceled = true;
      closeBridgeRef.current();
    };
  }, [link.pluginId, link.viewId, locale, publicationRevision]);

  // Layout effects register before iframe subresource navigation scripts have
  // the opportunity to run; a missed proof fails closed (no MessagePort).
  useLayoutEffect(() => {
    if (frame.kind !== "frame") return;
    const active = frame;
    let canceled = false;
    provedRef.current = false;
    firstLoadRef.current = false;

    const validFrame = () =>
      !canceled && frameRef.current?.isConnected === true &&
      getActivePublicationId() === active.publicationId;
    const revoke = () => {
      if (!validFrame()) return;
      closeBridgeRef.current();
      provedRef.current = false;
      setFrame({ kind: "error" });
    };
    const onMessage = (event: MessageEvent<unknown>) => {
      const element = frameRef.current;
      if (!element || !validFrame() || event.source !== element.contentWindow ||
          event.origin !== "null") return;
      const proof = ExtensionAdminFrameProofSchema.safeParse(event.data);
      if (!proof.success || proof.data.bridgeNonce !== active.bridgeNonce) return;
      if (proof.data.type === "vibress:extension:gone") {
        revoke();
        return;
      }
      if (provedRef.current) return;
      provedRef.current = true;
      closeBridgeRef.current();
      closeBridgeRef.current = connectAdminExtensionReadBridge(
        element, locale,
        () => validFrame() && provedRef.current,
        () => readExtensionAdminViewApi(link).catch((error: unknown) => {
          if (error instanceof ApiError && [401, 403, 404].includes(error.statusCode)) revoke();
          throw error;
        }),
      );
    };
    window.addEventListener("message", onMessage);

    // Re-authorize even if the plugin never reads again, so permission and
    // plugin disablement cannot leave an open stale iframe indefinitely.
    let checking = false;
    const timer = window.setInterval(() => {
      if (checking || canceled) return;
      if (!validFrame()) {
        revoke();
        return;
      }
      checking = true;
      void readExtensionAdminFrameStatusApi(link).then(({ sha256 }) => {
        if (sha256 !== active.sha256) revoke();
      }).catch(() => revoke()).finally(() => { checking = false; });
    }, REVOCATION_CHECK_MS);

    return () => {
      canceled = true;
      window.clearInterval(timer);
      window.removeEventListener("message", onMessage);
      closeBridgeRef.current();
      provedRef.current = false;
    };
  }, [frame, link.pluginId, link.viewId, locale]);

  const current = frame.kind === "frame" &&
    frame.publicationId === getActivePublicationId();

  function onFrameLoad() {
    if (frame.kind !== "frame" || !current) return;
    // The initial load follows the trusted bootstrap; every subsequent
    // navigation invalidates the frame even if the new page is opaque.
    if (!provedRef.current) return;
    if (firstLoadRef.current) {
      closeBridgeRef.current();
      provedRef.current = false;
      setFrame({ kind: "error" });
      return;
    }
    firstLoadRef.current = true;
  }

  if (frame.kind === "legacy") return <PluginAdminDataView link={link} />;

  return (
    <section className="w-full max-w-5xl mx-auto space-y-4" aria-label={link.title[locale]}>
      <h1 className="text-xl font-bold tracking-tight" dir="auto">{link.title[locale]}</h1>
      {frame.kind === "error" ? (
        <p role="alert">{tr("Unable to load plugin view.")}</p>
      ) : frame.kind === "loading" || !current ? (
        <p role="status">{tr("Loading plugin view...")}</p>
      ) : (
        <iframe
          ref={frameRef}
          onLoad={onFrameLoad}
          key={frame.src}
          title={link.title[locale]}
          src={frame.src}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          className="w-full min-h-[65vh] rounded-xl border border-border bg-background"
        />
      )}
    </section>
  );
}
