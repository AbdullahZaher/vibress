import { useEffect, useState } from "react";
import {
  AdminPlugin,
  activatePluginApi,
  deactivatePluginApi,
  setPluginPublicationStateApi,
  listOperatorTrustedPluginsApi,
  registerOperatorTrustedPluginApi,
  type AdminOperatorPlugin,
} from "../../lib/api";
import { useAdminLocale } from "../../lib/admin-locale";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Badge } from "../ui/badge";
import { Puzzle } from "lucide-react";

interface PluginsPanelProps {
  plugins: AdminPlugin[];
  onError: (message: string) => void;
  onChanged: () => Promise<void>;
}

export function PluginsPanel({
  plugins,
  onError,
  onChanged,
}: PluginsPanelProps) {
  const { tr } = useAdminLocale();
  const [busyPluginId, setBusyPluginId] = useState<string | null>(null);
  const [approved, setApproved] = useState<AdminOperatorPlugin[]>([]);

  useEffect(() => {
    let canceled = false;
    void listOperatorTrustedPluginsApi()
      .then((response) => { if (!canceled) setApproved(response.plugins); })
      .catch(() => { if (!canceled) setApproved([]); });
    return () => { canceled = true; };
  }, [plugins]);

  const apply = async (id: string, action: () => Promise<unknown>) => {
    if (busyPluginId) return;
    setBusyPluginId(id);
    try {
      await action();
      await onChanged();
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : tr("Plugin action failed"));
    } finally {
      setBusyPluginId(null);
    }
  };

  const available = approved.filter((candidate) =>
    !plugins.some((plugin) => plugin.manifestId === candidate.id));

  return (
    <div className="space-y-4">
      {available.length > 0 && (
        <section aria-label={tr("Operator-approved plugins")} className="space-y-2">
          <h3 className="text-sm font-semibold">{tr("Operator-approved plugins")}</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {available.map((candidate) => (
              <Card key={candidate.id} className="p-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-semibold break-words" dir="auto">{candidate.name}</p>
                  <p className="text-xs text-muted-foreground" dir="auto">
                    {candidate.id} · {candidate.version}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busyPluginId !== null}
                  onClick={() => apply(candidate.id, () =>
                    registerOperatorTrustedPluginApi(candidate.id))}
                  aria-label={`${tr("Register trusted plugin")}: ${candidate.name}`}
                >
                  {tr("Register trusted plugin")}
                </Button>
              </Card>
            ))}
          </div>
        </section>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {plugins.length === 0 ? (
        <div className="col-span-2 p-8 text-center text-xs text-muted-foreground border border-dashed border-border rounded-lg">
          {tr("No platform plugins installed.")}
        </div>
      ) : (
        plugins.map((plugin) => {
          const globalActive = plugin.status === "active";
          const scoped = plugin.publicationScoped === true;
          const siteEnabled = scoped && plugin.publicationEnabled === true;
          const busy = busyPluginId !== null;
          return (
            <Card key={plugin.id} className="p-5 bg-card border-border shadow-2xs space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Puzzle className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                  <h4 className="font-bold text-xs text-foreground truncate" dir="auto">{plugin.name}</h4>
                </div>
                <Badge
                  variant="outline"
                  className="text-[10px] font-mono px-2 py-0.5 bg-muted text-muted-foreground border-border"
                >
                  {globalActive ? tr("Active") : tr("Inactive")}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground font-mono break-all" dir="auto">
                {tr("Manifest ID")}: {plugin.manifestId}
              </p>
              {scoped && (
                <p role="status" className="text-xs text-muted-foreground">
                  {tr("This publication")}: {siteEnabled ? tr("Enabled") : tr("Disabled")}
                </p>
              )}
              <div className="pt-2 border-t border-border flex flex-wrap justify-end gap-2">
                {scoped && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy || !globalActive}
                    onClick={() => apply(plugin.id, () =>
                      setPluginPublicationStateApi(plugin.id, !siteEnabled))}
                    aria-label={`${siteEnabled ? tr("Disable for this publication") : tr("Enable for this publication")}: ${plugin.name}`}
                    className="h-7 text-xs border-border bg-card hover:bg-accent text-foreground"
                  >
                    {siteEnabled ? tr("Disable for this publication") : tr("Enable for this publication")}
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => apply(plugin.id, () =>
                    globalActive ? deactivatePluginApi(plugin.id) : activatePluginApi(plugin.id))}
                  aria-label={`${globalActive ? tr("Deactivate") : tr("Activate")}: ${plugin.name}`}
                  className="h-7 text-xs border-border bg-card hover:bg-accent text-foreground"
                >
                  {globalActive ? tr("Deactivate") : tr("Activate")}
                </Button>
              </div>
            </Card>
          );
        })
      )}
      </div>
    </div>
  );
}
