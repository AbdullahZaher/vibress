import React, { useState } from "react";
import { SettingsCard } from "../SettingsCard";
import { SettingsCardRow } from "../SettingsCardRow";
import { SettingsModalPortal } from "../SettingsModalPortal";
import { Button } from "../../ui/button";
import {
  AlertTriangle,
  X,
  ShieldAlert,
  CheckCircle2,
  RefreshCw,
  Database,
} from "lucide-react";
import { Badge } from "../../ui/badge";
import { runMaintenanceApi } from "../../../lib/api/operations";
import { useAdminLocale } from "../../../lib/admin-locale";
import { useSettingsConfirmation } from "../hooks/useSettingsConfirmation";

interface DangerZoneCardProps {
  isHighlighted?: boolean | undefined;
}

export const DangerZoneCard: React.FC<DangerZoneCardProps> = ({
  isHighlighted,
}) => {
  const { tr } = useAdminLocale();
  const { confirm, confirmationDialog } = useSettingsConfirmation();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [runningOp, setRunningOp] = useState<string | null>(null);
  const [opSuccess, setOpSuccess] = useState<string | null>(null);
  const [opError, setOpError] = useState<string | null>(null);

  const handleExecuteMaintenance = async (op: string) => {
    if (runningOp !== null) return;
    const confirmed = await confirm(tr(op === "cache-purge"
      ? "Purge all dynamic caches?"
      : "Rebuild all search indices?"));
    if (!confirmed) return;
    setRunningOp(op);
    setOpSuccess(null);
    setOpError(null);
    try {
      await runMaintenanceApi(op);
      setOpSuccess(
        op === "cache-purge"
          ? "Application & Redis caches purged successfully."
          : "Search indices rebuilt successfully.",
      );
    } catch {
      setOpError(`Failed to execute ${op} maintenance operation.`);
    } finally {
      setRunningOp(null);
    }
  };

  return (
    <>
      <SettingsCard
        id="advanced-danger"
        isHighlighted={isHighlighted}
        className="border-destructive/30"
      >
        <SettingsCardRow
          icon={<AlertTriangle className="h-4 w-4 text-destructive" />}
          title="Danger zone & maintenance"
          description="High-impact system maintenance, global cache invalidation, and destructive protection policies."
          currentValue={
            <Badge
              variant="outline"
              className="text-xs font-mono text-destructive border-destructive/30"
            >
              Protected Actions
            </Badge>
          }
          actionLabel="Access zone"
          actionVariant="destructive"
          onAction={() => {
            setIsModalOpen(true);
            setOpSuccess(null);
            setOpError(null);
          }}
        />
      </SettingsCard>

      {/* Danger Zone Modal */}
      <SettingsModalPortal
        title="Danger zone"
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
      >
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="w-full max-w-lg bg-card border border-destructive/40 rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between p-5 border-b border-destructive/20 bg-destructive/10">
              <div className="flex items-center gap-2 text-destructive">
                <AlertTriangle className="h-4 w-4" />
                <h3 className="text-sm font-bold">
                  {tr("System Maintenance & Danger Zone")}
                </h3>
              </div>
              <button
                type="button"
                aria-label={tr("Close dialog")}
                onClick={() => setIsModalOpen(false)}
                className="inline-flex size-11 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {opSuccess && (
                <div className="p-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  <span>{opSuccess}</span>
                </div>
              )}

              {opError && (
                <div className="p-3 rounded-xl border border-destructive/30 bg-destructive/10 text-destructive text-xs flex items-center gap-2">
                  <ShieldAlert className="h-4 w-4 shrink-0" />
                  <span>{opError}</span>
                </div>
              )}

              {/* Maintenance operations */}
              <div className="space-y-3">
                <div className="flex flex-col gap-3 rounded-xl border border-border/80 bg-muted/20 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h4 className="text-xs font-bold text-foreground">
                      {tr("Purge All Dynamic Caches")}
                    </h4>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {tr("Flushes cached posts, settings and author listings.")}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={runningOp !== null}
                    onClick={() => handleExecuteMaintenance("cache-purge")}
                    className="min-h-11 w-full shrink-0 gap-1.5 text-sm sm:w-auto"
                  >
                    <RefreshCw
                      className={`h-3 w-3 ${runningOp === "cache-purge" ? "animate-spin" : ""}`}
                    />
                    {tr(runningOp === "cache-purge" ? "Purging..." : "Purge cache")}
                  </Button>
                </div>

                <div className="flex flex-col gap-3 rounded-xl border border-border/80 bg-muted/20 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h4 className="text-xs font-bold text-foreground">
                      {tr("Rebuild Search Indices")}
                    </h4>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {tr("Reindexes published articles and pages for search.")}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={runningOp !== null}
                    onClick={() => handleExecuteMaintenance("search-reindex")}
                    className="min-h-11 w-full shrink-0 gap-1.5 text-sm sm:w-auto"
                  >
                    <Database
                      className={`h-3 w-3 ${runningOp === "search-reindex" ? "animate-spin" : ""}`}
                    />
                    {runningOp === "search-reindex"
                      ? tr("Reindexing...")
                      : tr("Reindex")}
                  </Button>
                </div>
              </div>

              {/* Destructive Policy Guard Notice */}
              <div className="p-4 rounded-xl border border-destructive/30 bg-destructive/5 space-y-1.5">
                <div className="flex items-center gap-1.5 text-destructive font-semibold text-xs">
                  <ShieldAlert className="h-4 w-4" />
                  <span>{tr("Database Purge & Reset Policy")}</span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {tr("Database reset is restricted in production. Use this authenticated CLI command only in a test environment:")}{" "}
                  <code className="font-mono text-primary text-xs">
                    pnpm db:reset
                  </code>
                  .
                </p>
              </div>

              <div className="flex items-center justify-end pt-2 border-t border-border/40">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setIsModalOpen(false)}
                  className="min-h-11 text-sm"
                >
                  {tr("Close")}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </SettingsModalPortal>
      {confirmationDialog}
    </>
  );
};
