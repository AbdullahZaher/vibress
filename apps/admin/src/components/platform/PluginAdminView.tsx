import { useEffect, useState } from "react";
import {
  ApiError, type AdminExtensionViewLink, issueExtensionAdminFrameTicketApi,
} from "../../lib/api";
import { getActivePublicationId } from "../../lib/api/client";
import { useAdminLocale } from "../../lib/admin-locale";
import { PluginAdminDataView } from "./PluginAdminDataView";

interface Props {
  link: AdminExtensionViewLink;
}

type FrameState =
  | { kind: "loading" }
  | { kind: "legacy" }
  | { kind: "error" }
  | { kind: "frame"; src: string; publicationId: string | null };

/**
 * The iframe has an opaque origin; it cannot access Admin DOM or cookies.
 * Browser plugin code has no API bridge. A missing B2B artifact uses the
 * unchanged EXT-301A Host-rendered scalar view; other errors fail closed.
 */
export function PluginAdminView({ link }: Props) {
  const { locale, tr } = useAdminLocale();
  const [publicationRevision, setPublicationRevision] = useState(0);
  const [frame, setFrame] = useState<FrameState>({ kind: "loading" });

  useEffect(() => {
    const onPublicationChanged = () => setPublicationRevision((n) => n + 1);
    window.addEventListener("vibress:publication-changed", onPublicationChanged);
    return () => window.removeEventListener("vibress:publication-changed", onPublicationChanged);
  }, []);

  useEffect(() => {
    let canceled = false;
    setFrame({ kind: "loading" });
    const publicationId = getActivePublicationId();
    void issueExtensionAdminFrameTicketApi(link).then(({ src }) => {
      if (canceled) return;
      // Refuse off-origin or plugin-controlled destinations, even if returned
      // by a misconfigured proxy. The backend owns the entire URL.
      const prefix = `/api/admin/v1/extensions/${encodeURIComponent(link.pluginId)}/views/${encodeURIComponent(link.viewId)}/frame?ticket=`;
      const token = src.startsWith(prefix) ? src.slice(prefix.length) : "";
      if (!/^[a-f0-9]{64}$/.test(token)) {
        setFrame({ kind: "error" });
        return;
      }
      setFrame({ kind: "frame", src, publicationId });
    }).catch((error: unknown) => {
      if (canceled) return;
      if (error instanceof ApiError && error.statusCode === 404) {
        setFrame({ kind: "legacy" });
      } else {
        setFrame({ kind: "error" });
      }
    });
    return () => { canceled = true; };
  }, [link.pluginId, link.viewId, publicationRevision]);

  const current = frame.kind === "frame" &&
    frame.publicationId === getActivePublicationId();

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
          key={frame.src}
          title={link.title[locale]}
          src={frame.src}
          // Never combine allow-scripts with allow-same-origin.
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          className="w-full min-h-[65vh] rounded-xl border border-border bg-background"
        />
      )}
    </section>
  );
}
