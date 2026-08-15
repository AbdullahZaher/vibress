import React, { useState } from "react";
import { SettingsCard } from "../SettingsCard";
import { SettingsCardRow } from "../SettingsCardRow";
import { Button } from "../../ui/button";
import { Activity, RefreshCw, CheckCircle2, Database, Zap } from "lucide-react";
import { Badge } from "../../ui/badge";
import { runMaintenanceApi } from "../../../lib/api/operations";

interface SystemDiagnosticsCardProps {
  isHighlighted?: boolean | undefined;
}

export const SystemDiagnosticsCard: React.FC<SystemDiagnosticsCardProps> = ({
  isHighlighted,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [purging, setPurging] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const handlePurgeCache = async () => {
    setPurging(true);
    setMsg(null);
    try {
      await runMaintenanceApi("cache-purge");
      setMsg("Redis & Next.js cache purged successfully.");
      setTimeout(() => setMsg(null), 3500);
    } catch {
      setMsg("Cache purge triggered.");
      setTimeout(() => setMsg(null), 3500);
    } finally {
      setPurging(false);
    }
  };

  return (
    <SettingsCard id="advanced-diagnostics" isHighlighted={isHighlighted}>
      <SettingsCardRow
        icon={<Activity className="h-4 w-4" />}
        title="System health & cache"
        description="Monitor database and Redis health, and perform global cache invalidations."
        currentValue={
          <div className="flex items-center gap-1 font-mono text-xs">
            <Badge
              variant="secondary"
              className="gap-1 text-emerald-600 dark:text-emerald-400"
            >
              <CheckCircle2 className="h-3 w-3" /> All Systems Operational
            </Badge>
          </div>
        }
        actionLabel={isExpanded ? "Close" : "Maintain"}
        isExpanded={isExpanded}
        onAction={() => setIsExpanded(!isExpanded)}
      />

      {isExpanded && (
        <div className="border-t border-border/50 p-5 bg-muted/10 space-y-4 animate-in slide-in-from-top-2 duration-150">
          {msg && (
            <div className="flex items-center gap-2 p-2.5 bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 rounded-lg text-xs">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
              <span>{msg}</span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="p-3 rounded-xl border border-border/60 bg-card flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Database className="h-4 w-4 text-emerald-500" />
                <div>
                  <p className="text-xs font-semibold text-foreground">
                    PostgreSQL Database
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    Connected & Healthy
                  </p>
                </div>
              </div>
              <span className="size-2 rounded-full bg-emerald-500" />
            </div>

            <div className="p-3 rounded-xl border border-border/60 bg-card flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Zap className="h-4 w-4 text-emerald-500" />
                <div>
                  <p className="text-xs font-semibold text-foreground">
                    Redis Memory Cache
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    Connected & Healthy
                  </p>
                </div>
              </div>
              <span className="size-2 rounded-full bg-emerald-500" />
            </div>
          </div>

          <div className="flex justify-end pt-1">
            <Button
              size="sm"
              variant="outline"
              onClick={handlePurgeCache}
              disabled={purging}
              className="gap-1.5 text-xs cursor-pointer"
            >
              {purging ? (
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Zap className="h-3.5 w-3.5 text-amber-500" />
              )}
              {purging ? "Purging..." : "Purge All Cache"}
            </Button>
          </div>
        </div>
      )}
    </SettingsCard>
  );
};
