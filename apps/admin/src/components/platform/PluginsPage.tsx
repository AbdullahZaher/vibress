import { useEffect, useRef, useState } from "react";
import { Puzzle, RefreshCw } from "lucide-react";
import { useAdminLocale } from "../../lib/admin-locale";
import { type AdminPlugin, listPluginsApi } from "../../lib/api";
import { Button } from "../ui/button";
import { PluginsPanel } from "./PluginsPanel";

/** First-class admin route: /admin/plugins (requires plugins.read). */
export function PluginsPage() {
  const { tr } = useAdminLocale();
  const [plugins, setPlugins] = useState<AdminPlugin[]>([]);
  const [platformOperator, setPlatformOperator] = useState(false);
  const [loading, setLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);

  const refresh = async (): Promise<void> => {
    const request = ++generation.current;
    setLoading(true);
    try {
      const result = await listPluginsApi();
      if (request !== generation.current) return;
      setPlugins(result.plugins);
      setPlatformOperator(result.platformOperator === true);
      setHasLoaded(true);
      setError(null);
    } catch (err: unknown) {
      if (request !== generation.current) return;
      setError(err instanceof Error ? err.message : tr("Failed to load plugins"));
    } finally {
      if (request === generation.current) setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    const onPublicationChanged = () => {
      generation.current += 1;
      setPlugins([]);
      setPlatformOperator(false);
      setHasLoaded(false);
      setError(null);
      void refresh();
    };
    window.addEventListener("vibress:publication-changed", onPublicationChanged);
    return () => {
      generation.current += 1;
      window.removeEventListener("vibress:publication-changed", onPublicationChanged);
    };
  }, []);

  return (
    <section className="w-full max-w-7xl mx-auto space-y-6" aria-labelledby="plugins-page-title">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 id="plugins-page-title" className="flex items-center gap-2 text-xl font-bold tracking-tight">
            <Puzzle className="size-5 text-primary" aria-hidden="true" />
            {tr("Plugins")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {tr("Manage installed plugins and trusted extensions.")}
          </p>
        </div>
        <Button variant="outline" size="sm" disabled={loading} onClick={() => { void refresh(); }}>
          <RefreshCw className="me-2 size-4" aria-hidden="true" />
          {tr("Refresh plugins")}
        </Button>
      </header>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {loading && (
        <p role="status" className="text-sm text-muted-foreground">
          {tr("Loading plugins...")}
        </p>
      )}
      {hasLoaded && (
        <PluginsPanel
          plugins={plugins}
          platformOperator={platformOperator}
          onError={setError}
          onChanged={refresh}
        />
      )}
    </section>
  );
}
