import { runMaintenanceApi } from '../../lib/api';
import { Button } from '../ui/button';
import { Card } from '../ui/card';

interface SystemPanelProps {
  diagnostics: Record<string, unknown>;
  onError: (message: string) => void;
  onMessage: (message: string) => void;
  onChanged: () => Promise<void>;
}

export function SystemPanel({ diagnostics, onError, onMessage, onChanged }: SystemPanelProps) {
  const handleRunMaintenance = async (task: string) => {
    try {
      await runMaintenanceApi(task);
      onMessage(`Maintenance task "${task}" executed.`);
      await onChanged();
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : 'Failed');
    }
  };

  return (
    <div className="space-y-6">
      <Card className="p-6 bg-transparent border-border shadow-2xs space-y-4">
        <h3 className="font-bold text-xs uppercase tracking-wider text-muted-foreground">SYSTEM DIAGNOSTICS</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 text-xs font-mono">
          {Object.entries(diagnostics).map(([k, v]) => (
            <div key={k} className="p-3 rounded-lg border border-border bg-muted/20 space-y-1">
              <span className="text-muted-foreground text-[10px] uppercase font-bold">{k}</span>
              <p className="text-foreground font-bold truncate">{String(v)}</p>
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-6 bg-transparent border-border shadow-2xs space-y-4">
        <h3 className="font-bold text-xs uppercase tracking-wider text-muted-foreground">MAINTENANCE TASKS</h3>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => handleRunMaintenance('clear_cache')} className="h-8 text-xs border-border bg-card hover:bg-accent text-foreground">
            Clear System Cache
          </Button>
          <Button variant="outline" size="sm" onClick={() => handleRunMaintenance('purge_temp')} className="h-8 text-xs border-border bg-card hover:bg-accent text-foreground">
            Purge Temporary Files
          </Button>
        </div>
      </Card>
    </div>
  );
}