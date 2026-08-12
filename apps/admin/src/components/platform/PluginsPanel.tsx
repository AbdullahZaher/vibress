import { AdminPlugin, activatePluginApi, deactivatePluginApi } from '../../lib/api';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { Badge } from '../ui/badge';
import { Puzzle } from 'lucide-react';

interface PluginsPanelProps {
  plugins: AdminPlugin[];
  onError: (message: string) => void;
  onChanged: () => Promise<void>;
}

export function PluginsPanel({ plugins, onError, onChanged }: PluginsPanelProps) {
  const handleTogglePlugin = async (p: AdminPlugin) => {
    try {
      if (p.status === 'active') {
        await deactivatePluginApi(p.id);
      } else {
        await activatePluginApi(p.id);
      }
      await onChanged();
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : 'Failed');
    }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {plugins.length === 0 ? (
        <div className="col-span-2 p-8 text-center text-xs text-muted-foreground border border-dashed border-border rounded-lg">
          No platform plugins installed.
        </div>
      ) : (
        plugins.map((p) => (
          <Card key={p.id} className="p-5 bg-card border-border shadow-2xs space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Puzzle className="h-4 w-4 text-primary" />
                <h4 className="font-bold text-xs text-foreground">{p.name}</h4>
              </div>
              {p.status === 'active' ? (
                <Badge variant="outline" className="text-[10px] font-mono px-2 py-0.5 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20">
                  Active
                </Badge>
              ) : (
                <Badge variant="outline" className="text-[10px] font-mono px-2 py-0.5 bg-muted text-muted-foreground border-border">
                  Inactive
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground font-mono">Manifest ID: {p.manifestId}</p>
            <div className="pt-2 border-t border-border flex justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleTogglePlugin(p)}
                className="h-7 text-xs border-border bg-card hover:bg-accent text-foreground"
              >
                {p.status === 'active' ? 'Deactivate' : 'Activate'}
              </Button>
            </div>
          </Card>
        ))
      )}
    </div>
  );
}