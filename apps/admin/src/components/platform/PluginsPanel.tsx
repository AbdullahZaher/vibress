import { useState } from "react";
import {
  AdminPlugin,
  activatePluginApi,
  deactivatePluginApi,
  setPluginPublicationStateApi,
} from "../../lib/api";
import { useAdminLocale } from "../../lib/admin-locale";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Badge } from "../ui/badge";
import { Puzzle } from "lucide-react";
import { ScopedPluginSettingsEditor } from "./ScopedPluginSettingsEditor";
import { FailedPluginEventsPanel } from "./FailedPluginEventsPanel";

interface PluginsPanelProps {
  plugins: AdminPlugin[];
  platformOperator: boolean;
  onError: (message: string) => void;
  onChanged: () => Promise<void>;
}

export function PluginsPanel({
  plugins,
  platformOperator,
  onError,
  onChanged,
}: PluginsPanelProps) {
  const { tr } = useAdminLocale();
  const [busyPluginId, setBusyPluginId] = useState<string | null>(null);
  const apply = async (id: string, action: () => Promise<unknown>) => {
    if (busyPluginId) return;
    setBusyPluginId(id);
    try {
      await action();
      await onChanged();
    } catch {
      // Backend failures can include sensitive operator paths or plugin content.
      onError(tr("Plugin action failed"));
    } finally {
      setBusyPluginId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {plugins.length === 0 ? (
        <div className="col-span-2 p-8 text-center text-xs text-muted-foreground border border-dashed border-border rounded-lg">
          {tr("No platform plugins installed.")}
        </div>
      ) : (
        plugins.map((plugin) => {
          const globalActive = plugin.status === "active";
          const registered = plugin.status === "registered" || plugin.status === "inactive";
          const transitioning = plugin.status === "activating" || plugin.status === "deactivating";
          const failed = plugin.status === "error";
          const incompatible = plugin.hostCompatible === false;
          const scoped = plugin.publicationScoped === true;
          const siteEnabled = scoped && plugin.publicationEnabled === true;
          const busy = busyPluginId !== null;
          const statusLabel = globalActive ? tr("Globally active")
            : plugin.status === "registered" ? tr("Registered, awaiting activation")
            : plugin.status === "inactive" ? tr("Globally inactive")
            : plugin.status === "activating" ? tr("Activating")
            : plugin.status === "deactivating" ? tr("Deactivating")
            : failed ? tr("Plugin lifecycle failed") : tr("Unknown plugin state");
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
                  {statusLabel}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground font-mono break-all" dir="auto">
                {tr("Manifest ID")}: {plugin.manifestId}
              </p>
              <p className="text-xs text-muted-foreground" dir="auto">
                {tr("Installed version")}: {plugin.version}
              </p>
              {incompatible && (
                <p role="alert" className="text-xs text-destructive">
                  {tr("Incompatible Host API version. Operator review and an approved update are required.")}
                </p>
              )}
              {transitioning && (
                <p role="status" className="text-xs text-muted-foreground">
                  {tr("Lifecycle transition in progress. Refresh before changing state.")}
                </p>
              )}
              {failed && (
                <p role="alert" className="text-xs text-destructive">
                  {tr("Recovery requires maintenance: stop all runtime replicas, inspect the failure, and follow the operator recovery runbook.")}
                </p>
              )}
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
                    disabled={busy || (!globalActive && !siteEnabled) || (incompatible && !siteEnabled)}
                    onClick={() => apply(plugin.id, () =>
                      setPluginPublicationStateApi(plugin.id, !siteEnabled))}
                    aria-label={`${siteEnabled ? tr("Disable for this publication") : tr("Enable for this publication")}: ${plugin.name}`}
                    className="h-7 text-xs border-border bg-card hover:bg-accent text-foreground"
                  >
                    {siteEnabled ? tr("Disable for this publication") : tr("Enable for this publication")}
                  </Button>
                )}
                {platformOperator && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy || transitioning || failed || (incompatible && !globalActive) || (!globalActive && !registered)}
                    onClick={() => apply(plugin.id, () =>
                      globalActive ? deactivatePluginApi(plugin.id) : activatePluginApi(plugin.id))}
                    aria-label={`${globalActive ? tr("Deactivate") : tr("Activate")}: ${plugin.name}`}
                    className="h-7 text-xs border-border bg-card hover:bg-accent text-foreground"
                  >
                    {globalActive ? tr("Deactivate") : tr("Activate")}
                  </Button>
                )}
              </div>
              {scoped && siteEnabled && (
                <ScopedPluginSettingsEditor plugin={plugin} onError={onError} />
              )}
              {platformOperator && scoped && globalActive && siteEnabled && (
                <FailedPluginEventsPanel pluginId={plugin.id} onError={onError} />
              )}
            </Card>
          );
        })
      )}
      </div>
    </div>
  );
}
