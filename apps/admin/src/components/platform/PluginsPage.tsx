import { useEffect, useRef, useState } from "react";
import { Plus, RefreshCw } from "lucide-react";
import { FailedPluginEventsPanel } from "./FailedPluginEventsPanel";
import { PluginActivityPanel } from "./PluginActivityPanel";
import { useAdminLocale } from "../../lib/admin-locale";
import {
  type AdminPlugin,
  type AdminExtensionViewLink,
  listPluginsApi,
  listExtensionAdminViewsApi,
} from "../../lib/api";
import { IconButton } from "../ui/icon-button";
import { Button } from "../ui/button";
import { TrustedPluginInstaller } from "./TrustedPluginInstaller";
import { AdminPageHeader } from "../common/AdminPageHeader";
import { PluginsPanel } from "./PluginsPanel";

type PluginSection = "installed" | "available" | "updates" | "activity";

export interface PluginsPageProps {
  onNavigate?: ((path: string) => void) | undefined;
  extensionViews?: readonly AdminExtensionViewLink[] | undefined;
}

/** First-class admin route: /admin/plugins (requires plugins.read). */
export function PluginsPage({ onNavigate, extensionViews }: PluginsPageProps = {}) {
  const { tr } = useAdminLocale();
  const [plugins, setPlugins] = useState<AdminPlugin[]>([]);
  const [views, setViews] = useState<readonly AdminExtensionViewLink[]>(extensionViews ?? []);
  const [platformOperator, setPlatformOperator] = useState(false);
  const [loading, setLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [section, setSection] = useState<PluginSection>("installed");
  const installedSectionRef = useRef<HTMLButtonElement>(null);
  const closeInstaller = () => {
    setAddOpen(false);
    setSection("installed");
    // Returning to the installed list works for both tabbed registration and
    // the original Add Plugin action; it does not rely on navigation timing.
    installedSectionRef.current?.focus();
  };

  const refresh = async (): Promise<void> => {
    const request = ++generation.current;
    setLoading(true);
    try {
      const result = await listPluginsApi();
      if (request !== generation.current) return;
      setPlugins(result.plugins);
      setPlatformOperator(result.platformOperator === true);
      if (result.platformOperator !== true) {
        setSection("installed");
        setAddOpen(false);
      }
      setHasLoaded(true);
      setError(null);
      if (!extensionViews) {
        try {
          const viewsRes = await listExtensionAdminViewsApi();
          if (request === generation.current) setViews(viewsRes.items);
        } catch {
          // Graceful fallback: views list remains empty
        }
      }
    } catch {
      if (request !== generation.current) return;
      setError(tr("Failed to load plugins"));
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
      setAddOpen(false);
      setSection("installed");
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
      <AdminPageHeader
        titleId="plugins-page-title"
        title={tr("Plugins")}
        description={tr("Manage installed plugins and trusted extensions.")}
        actions={
          <>
          {platformOperator && hasLoaded && (
            <Button ref={addButtonRef} type="button" size="sm"
              aria-expanded={addOpen} aria-controls="trusted-installer"
              onClick={() => {
                setAddOpen(section === "installed" ? !addOpen : true);
                setSection("installed");
              }}>
              <Plus className="size-4" aria-hidden="true" />
              {tr("Add Plugin")}
            </Button>
          )}
          <IconButton
            label={tr("Refresh plugins")}
            variant="outline"
            disabled={loading}
            onClick={() => { void refresh(); }}
          >
            <RefreshCw className="size-4" aria-hidden="true" />
          </IconButton>
          </>
        }
      />
      {hasLoaded && (
        <>
          <nav aria-label={tr("Plugin sections")}
            className="flex flex-wrap gap-1 border-b border-border" >
            {([
              { id: "installed" as const, label: tr("Installed plugins") },
              ...(platformOperator ? ([
                { id: "available" as const, label: tr("Available approved plugins") },
                { id: "updates" as const, label: tr("Approved updates") },
                { id: "activity" as const, label: tr("Plugin activity") },
              ]) : []),
            ]).map((item) => (
              <button key={item.id} type="button"
                ref={item.id === "installed" ? installedSectionRef : undefined}
                aria-pressed={section === item.id}
                aria-controls="plugin-section-content"
                className={`px-3 py-2 text-sm border-b-2 -mb-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-t-sm ${section === item.id
                  ? "border-primary text-foreground font-medium"
                  : "border-transparent text-muted-foreground hover:text-foreground"}`}
                onClick={() => { setSection(item.id); setAddOpen(false); }}>
                {item.label}
              </button>
            ))}
          </nav>
          <div id="plugin-section-content">
            {section === "installed" && (
              <>
                {platformOperator && addOpen && (
                  <div id="trusted-installer" className="mb-4">
                    <TrustedPluginInstaller
                      installedIds={plugins.map((plugin) => plugin.manifestId)}
                      installedPlugins={plugins}
                      onRegistered={refresh}
                      onClose={closeInstaller}
                    />
                  </div>
                )}
                <PluginsPanel
                  plugins={plugins}
                  platformOperator={platformOperator}
                  onError={setError}
                  onChanged={refresh}
                  extensionViews={views}
                  onNavigate={onNavigate}
                />
              </>
            )}
            {platformOperator && (section === "available" || section === "updates") && (
              <TrustedPluginInstaller key={section}
                show={section === "available" ? "new" : "updates"}
                installedIds={plugins.map((plugin) => plugin.manifestId)}
                installedPlugins={plugins}
                onRegistered={refresh}
                onClose={closeInstaller}
              />
            )}
            {platformOperator && section === "activity" && (
              <section aria-label={tr("Plugin activity")} className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  {tr("This history includes selected audited actions for the current publication, not every plugin lifecycle event.")}
                </p>
                {plugins.filter((plugin) => plugin.publicationScoped === true)
                  .map((plugin) => (
                    <div key={plugin.id} className="rounded-lg border border-border p-3 space-y-2">
                      <h2 className="text-sm font-medium break-words" dir="auto">{plugin.name}</h2>
                      <PluginActivityPanel pluginId={plugin.id}
                        onError={() => setError(tr("Failed to load plugin activity"))} />
                      {plugin.status === "active" && plugin.publicationEnabled === true && (
                        <FailedPluginEventsPanel pluginId={plugin.id}
                          onError={() => setError(tr("Failed to load plugin events"))} />
                      )}
                    </div>
                  ))}
                {!plugins.some((plugin) => plugin.publicationScoped === true) && (
                  <p role="status" className="text-sm text-muted-foreground">
                    {tr("No publication-scoped plugins installed.")}
                  </p>
                )}
              </section>
            )}
          </div>
        </>
      )}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {loading && (
        <p role="status" className="text-sm text-muted-foreground">
          {tr("Loading plugins...")}
        </p>
      )}
    </section>
  );
}
