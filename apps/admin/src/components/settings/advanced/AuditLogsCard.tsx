import React, { useState } from "react";
import { SettingsCard } from "../SettingsCard";
import { SettingsCardRow } from "../SettingsCardRow";
import { SettingsModalPortal } from "../SettingsModalPortal";
import { Button } from "../../ui/button";
import { ShieldCheck, History, Clock, X, RefreshCw } from "lucide-react";
import { Badge } from "../../ui/badge";
import { listAuditApi, AdminAuditEvent } from "../../../lib/api/operations";

interface AuditLogsCardProps {
  isHighlighted?: boolean | undefined;
}

export const AuditLogsCard: React.FC<AuditLogsCardProps> = ({
  isHighlighted,
}) => {
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [events, setEvents] = useState<AdminAuditEvent[]>([]);
  const [loading, setLoading] = useState(false);

  const loadAudit = () => {
    setLoading(true);
    listAuditApi({ limit: 20 })
      .then((res) => setEvents(res.events || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  const handleOpen = () => {
    setIsDrawerOpen(true);
    loadAudit();
  };

  return (
    <>
      <SettingsCard id="advanced-audit" isHighlighted={isHighlighted}>
        <SettingsCardRow
          icon={<History className="h-4 w-4" />}
          title="Audit & activity log"
          description="Immutable security trail of administrative actions, logins, and setting modifications."
          currentValue={
            <Badge
              variant="secondary"
              className="text-xs font-mono gap-1 text-emerald-600 dark:text-emerald-400"
            >
              <ShieldCheck className="h-3 w-3" /> Audit Logging Active
            </Badge>
          }
          actionLabel="View audit trail"
          onAction={handleOpen}
        />
      </SettingsCard>

      {/* Audit Logs Drawer */}
      <SettingsModalPortal
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
      >
        <div className="fixed inset-0 z-50 flex justify-end bg-background/70 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="w-full max-w-2xl bg-card border-l border-border/80 shadow-2xl h-full flex flex-col justify-between animate-in slide-in-from-right duration-200">
            {/* Header */}
            <div className="flex items-center justify-between p-5 border-b border-border/60 bg-muted/20">
              <div className="flex items-center gap-2">
                <History className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-bold text-foreground">
                  Audit & Security Activity Log
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsDrawerOpen(false)}
                className="text-muted-foreground hover:text-foreground p-1 rounded-md cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Body */}
            <div className="p-6 overflow-y-auto space-y-4 flex-1">
              {loading ? (
                <div className="flex items-center justify-center py-16 text-muted-foreground text-xs">
                  <RefreshCw className="h-4 w-4 animate-spin mr-2" /> Loading
                  audit records...
                </div>
              ) : events.length === 0 ? (
                <div className="p-8 rounded-xl border border-dashed border-border/70 text-center space-y-2 bg-muted/10">
                  <p className="text-xs text-muted-foreground">
                    No recent audit log entries recorded.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-border/40 rounded-xl border border-border/60 bg-muted/10 overflow-hidden">
                  {events.map((ev) => (
                    <div
                      key={ev.id}
                      className="flex items-center justify-between p-3.5 text-xs"
                    >
                      <div className="flex items-center gap-2.5">
                        <ShieldCheck className="h-4 w-4 text-emerald-500 shrink-0" />
                        <div>
                          <span className="font-semibold text-foreground font-mono">
                            {ev.action}
                          </span>
                          {ev.actorUserId && (
                            <p className="text-[11px] text-muted-foreground font-mono">
                              User: {ev.actorUserId}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 text-muted-foreground text-[11px] shrink-0">
                        <Clock className="h-3 w-3" />
                        <span>{new Date(ev.createdAt).toLocaleString()}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-border/60 bg-muted/20 flex justify-end">
              <Button
                size="sm"
                onClick={() => setIsDrawerOpen(false)}
                className="text-xs cursor-pointer"
              >
                Close
              </Button>
            </div>
          </div>
        </div>
      </SettingsModalPortal>
    </>
  );
};
