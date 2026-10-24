import { useId, useState } from "react";
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
import { Puzzle, Search } from "lucide-react";
import { Input } from "../ui/input";
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
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive" | "attention">("all");
  const searchId = useId();
  const statusId = useId();
  const query = searchQuery.trim().toLocaleLowerCase();
  // Client-side display filters only. The server remains authoritative for
  // permissions, publication scoping and lifecycle mutations.
  const visiblePlugins = plugins.filter((plugin) => {
    const matchesText = !query || [plugin.name, plugin.manifestId, plugin.version]
      .some((value) => value.toLocaleLowerCase().includes(query));
    const matchesStatus = statusFilter === "all" ||
      (statusFilter === "active" && plugin.status === "active") ||
      (statusFilter === "inactive" && ["inactive", "registered"].includes(plugin.status)) ||
      (statusFilter === "attention" && (plugin.hostCompatible === false ||
        ["error", "activating", "deactivating"].includes(plugin.status)));
    return matchesText && matchesStatus;
  });
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
      {plugins.length > 0 && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <label htmlFor={searchId} className="sr-only">{tr("Search installed plugins")}</label>
          <div className="relative w-full sm:max-w-sm">
            <Search className="absolute start-2.5 top-2.5 size-4 text-muted-foreground pointer-events-none"
              aria-hidden="true" />
            <Input id={searchId} type="search" value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={tr("Search installed plugins")}
              className="h-9 ps-9" />
          </div>
          <label htmlFor={statusId} className="sr-only">{tr("Filter plugin status")}</label>
          <select id={statusId} value={statusFilter}
            onChange={(event) => {
              const next = event.target.value;
              if (next === "all" || next === "active" ||
                  next === "inactive" || next === "attention") {
                setStatusFilter(next);
              }
            }}
            className="h-9 w-full sm:w-52 rounded-md border border-border/70 bg-background px-3 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <option value="all">{tr("All plugin statuses")}</option>
            <option value="active">{tr("Globally active")}</option>
            <option value="inactive">{tr("Inactive or registered")}</option>
            <option value="attention">{tr("Needs attention")}</option>
          </select>
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {plugins.length === 0 ? (
        <div className="col-span-2 p-8 text-center text-xs text-muted-foreground border border-dashed border-border rounded-lg">
          {tr("No platform plugins installed.")}
        </div>
      ) : visiblePlugins.length === 0 ? (
        <p role="status" className="col-span-2 p-8 text-center text-xs text-muted-foreground border border-dashed border-border rounded-lg">
          {tr("No plugins match your search or status filter.")}
        </p>
      ) : (
        visiblePlugins.map((plugin) => {
          const globalActive = plugin.status === "active";
          const registered = plugin.status === "registered" || plugin.status === "inactive" || plugin.status === "error";
          const transitioning = plugin.status === "activating" || plugin.status === "deactivating";
          const failed = plugin.status === "error";
          const incompatible = plugin.hostCompatible === false;
          const scoped = plugin.publicationScoped === true;
          const siteEnabled = scoped && plugin.publicationEnabled === true;
          const siteConfigured = scoped &&
            (plugin.publicationConfiguredEnabled ?? plugin.publicationEnabled) === true;
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
                  {" "}
                  {tr("A stuck transition requires isolated operator maintenance recovery.")}
                </p>
              )}
              {failed && (
                <p role="alert" className="text-xs text-destructive">
                  {tr("Activation failed. Review operator logs and the approved release before retrying.")}
                </p>
              )}
              {scoped && (
                <>
                  <p role="status" className="text-xs text-muted-foreground">
                    {tr("This publication")}: {siteEnabled ? tr("Enabled") : tr("Disabled")}
                  </p>
                  {siteConfigured !== siteEnabled && (
                    <p className="text-xs text-muted-foreground">
                      {tr("Saved site setting")}: {siteConfigured ? tr("Enabled") : tr("Disabled")}
                      {" — "}
                      {tr("Currently inactive until global activation.")}
                    </p>
                  )}
                </>
              )}
              <div className="pt-2 border-t border-border flex flex-wrap justify-end gap-2">
                {scoped && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy || (!globalActive && !siteConfigured) || (incompatible && !siteConfigured)}
                    onClick={() => apply(plugin.id, () =>
                      setPluginPublicationStateApi(plugin.id, !siteConfigured))}
                    aria-label={`${siteConfigured ? tr("Disable for this publication") : tr("Enable for this publication")}: ${plugin.name}`}
                    className="h-7 text-xs border-border bg-card hover:bg-accent text-foreground"
                  >
                    {siteConfigured ? tr("Disable for this publication") : tr("Enable for this publication")}
                  </Button>
                )}
                {platformOperator && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy || transitioning || (incompatible && !globalActive) || (!globalActive && !registered)}
                    onClick={() => apply(plugin.id, () =>
                      globalActive ? deactivatePluginApi(plugin.id) : activatePluginApi(plugin.id))}
                    aria-label={`${globalActive ? tr("Deactivate") : failed ? tr("Retry activation") : tr("Activate")}: ${plugin.name}`}
                    className="h-7 text-xs border-border bg-card hover:bg-accent text-foreground"
                  >
                    {globalActive ? tr("Deactivate") : failed ? tr("Retry activation") : tr("Activate")}
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
