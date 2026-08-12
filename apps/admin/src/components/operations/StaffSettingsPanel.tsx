import { AdminSettingValue, updateSettingApi } from '../../lib/api';
import { Button } from '../ui/button';
import { Card } from '../ui/card';

interface StaffSettingsPanelProps {
  settings: Array<{ namespace: string; settings: AdminSettingValue[] }>;
  onError: (message: string) => void;
  onMessage: (message: string) => void;
  onChanged: () => Promise<void>;
}

export function StaffSettingsPanel({ settings, onError, onMessage, onChanged }: StaffSettingsPanelProps) {
  const handleUpdateSetting = async (namespace: string, key: string, value: unknown) => {
    try {
      await updateSettingApi(namespace, key, value);
      onMessage(`Setting "${key}" updated`);
      await onChanged();
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : 'Failed');
    }
  };

  return (
    <div className="space-y-6">
      {settings.map((ns) => (
        <Card key={ns.namespace} className="p-6 bg-card border-border shadow-2xs space-y-4">
          <h3 className="font-bold text-xs uppercase tracking-wider text-muted-foreground">Namespace: {ns.namespace}</h3>
          <div className="space-y-3">
            {ns.settings.map((st) => (
              <div key={st.key} className="flex items-center justify-between gap-4 py-1 border-b border-border/40 last:border-0">
                <div>
                  <span className="font-bold text-xs text-foreground font-mono">{st.key}</span>
                  <p className="text-[11px] text-muted-foreground">Value: {JSON.stringify(st.value)}</p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleUpdateSetting(ns.namespace, st.key, st.value)}
                  className="h-7 text-xs border-border bg-card hover:bg-accent text-foreground"
                >
                  Update
                </Button>
              </div>
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}