import { useEffect, useState } from "react";
import { type AdminExtensionViewLink, readExtensionAdminViewApi } from "../../lib/api";
import { useAdminLocale } from "../../lib/admin-locale";

interface Props {
  link: AdminExtensionViewLink;
}

/**
 * Host-owned renderer: text-only, read-only scalar projection. Never evaluate
 * plugin JSX, HTML, JS, iframe URLs or browser-side plugin modules.
 */
export function PluginAdminDataView({ link }: Props) {
  const { locale, tr } = useAdminLocale();
  const [data, setData] = useState<Record<string, string | number | boolean> | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(false);
    void readExtensionAdminViewApi(link).then((result) => {
      if (!cancelled) setData(result);
    }).catch(() => {
      if (!cancelled) setError(true);
    });
    return () => { cancelled = true; };
  }, [link.pluginId, link.routeId]);

  return (
    <section aria-labelledby="plugin-admin-view-title" className="w-full max-w-5xl mx-auto space-y-6">
      <header className="space-y-1">
        <h1 id="plugin-admin-view-title" dir="auto" className="text-xl font-bold tracking-tight">
          {link.title[locale]}
        </h1>
        <p className="text-sm text-muted-foreground">{tr("Read-only plugin view")}</p>
      </header>
      {error ? (
        <p role="alert">{tr("Unable to load plugin view.")}</p>
      ) : data === null ? (
        <p role="status">{tr("Loading plugin view...")}</p>
      ) : (
        <dl className="rounded-xl border border-border divide-y divide-border">
          {Object.entries(data).map(([key, value]) => (
            <div key={key} className="grid grid-cols-1 gap-2 px-4 py-3 sm:grid-cols-3">
              <dt dir="auto" className="text-sm font-medium text-muted-foreground break-words">{key}</dt>
              <dd dir="auto" className="text-sm break-words sm:col-span-2">{String(value)}</dd>
            </div>
          ))}
          {Object.keys(data).length === 0 && (
            <div className="px-4 py-3 text-sm text-muted-foreground">{tr("No plugin data available.")}</div>
          )}
        </dl>
      )}
    </section>
  );
}
