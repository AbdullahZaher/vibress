import React, { useState } from 'react';
import { SettingsCard } from '../SettingsCard';
import { SettingsCardRow } from '../SettingsCardRow';
import { SettingsModalPortal } from '../SettingsModalPortal';
import { Button } from '../../ui/button';
import { AlertTriangle, X, ShieldAlert, CheckCircle2, RefreshCw, Database } from 'lucide-react';
import { Badge } from '../../ui/badge';
import { runMaintenanceApi } from '../../../lib/api/operations';

interface DangerZoneCardProps {
  isHighlighted?: boolean | undefined;
}

export const DangerZoneCard: React.FC<DangerZoneCardProps> = ({ isHighlighted }) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [runningOp, setRunningOp] = useState<string | null>(null);
  const [opSuccess, setOpSuccess] = useState<string | null>(null);
  const [opError, setOpError] = useState<string | null>(null);

  const handleExecuteMaintenance = async (op: string) => {
    setRunningOp(op);
    setOpSuccess(null);
    setOpError(null);
    try {
      await runMaintenanceApi(op);
      setOpSuccess(
        op === 'cache-purge'
          ? 'Application & Redis caches purged successfully.'
          : 'Search indices rebuilt successfully.'
      );
    } catch {
      setOpError(`Failed to execute ${op} maintenance operation.`);
    } finally {
      setRunningOp(null);
    }
  };

  return (
    <>
      <SettingsCard id="advanced-danger" isHighlighted={isHighlighted} className="border-destructive/30">
        <SettingsCardRow
          icon={<AlertTriangle className="h-4 w-4 text-destructive" />}
          title="Danger zone & maintenance"
          description="High-impact system maintenance, global cache invalidation, and destructive protection policies."
          currentValue={
            <Badge variant="outline" className="text-xs font-mono text-destructive border-destructive/30">
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
      <SettingsModalPortal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)}>
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="w-full max-w-lg bg-card border border-destructive/40 rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between p-5 border-b border-destructive/20 bg-destructive/10">
              <div className="flex items-center gap-2 text-destructive">
                <AlertTriangle className="h-4 w-4" />
                <h3 className="text-sm font-bold">System Maintenance & Danger Zone</h3>
              </div>
              <button
                type="button"
                aria-label="Close danger zone modal"
                onClick={() => setIsModalOpen(false)}
                className="text-muted-foreground hover:text-foreground p-1 rounded-md cursor-pointer"
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
                <div className="p-4 rounded-xl border border-border/80 bg-muted/20 flex items-center justify-between gap-3">
                  <div>
                    <h4 className="text-xs font-bold text-foreground">Purge All Dynamic Caches</h4>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Flushes Redis cache keys for public posts, settings namespaces, and author listings.
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={runningOp !== null}
                    onClick={() => handleExecuteMaintenance('cache-purge')}
                    className="shrink-0 text-xs gap-1.5 cursor-pointer h-8"
                  >
                    <RefreshCw className={`h-3 w-3 ${runningOp === 'cache-purge' ? 'animate-spin' : ''}`} />
                    {runningOp === 'cache-purge' ? 'Purging...' : 'Purge cache'}
                  </Button>
                </div>

                <div className="p-4 rounded-xl border border-border/80 bg-muted/20 flex items-center justify-between gap-3">
                  <div>
                    <h4 className="text-xs font-bold text-foreground">Rebuild Search Indices</h4>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Reindexes all published articles and pages into the search document database.
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={runningOp !== null}
                    onClick={() => handleExecuteMaintenance('search-reindex')}
                    className="shrink-0 text-xs gap-1.5 cursor-pointer h-8"
                  >
                    <Database className={`h-3 w-3 ${runningOp === 'search-reindex' ? 'animate-spin' : ''}`} />
                    {runningOp === 'search-reindex' ? 'Reindexing...' : 'Reindex'}
                  </Button>
                </div>
              </div>

              {/* Destructive Policy Guard Notice */}
              <div className="p-4 rounded-xl border border-destructive/30 bg-destructive/5 space-y-1.5">
                <div className="flex items-center gap-1.5 text-destructive font-semibold text-xs">
                  <ShieldAlert className="h-4 w-4" />
                  <span>Database Purge & Reset Policy</span>
                </div>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  Direct HTTP deletion of all publication records is intentionally restricted in production to prevent catastrophic data loss. To wipe or reset test databases, use the authenticated CLI command <code className="font-mono text-primary text-[10px]">pnpm db:reset</code>.
                </p>
              </div>

              <div className="flex items-center justify-end pt-2 border-t border-border/40">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setIsModalOpen(false)}
                  className="text-xs cursor-pointer"
                >
                  Close
                </Button>
              </div>
            </div>
          </div>
        </div>
      </SettingsModalPortal>
    </>
  );
};

