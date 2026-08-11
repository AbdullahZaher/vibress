import React, { useState } from 'react';
import { AdminAutomation, createAutomationApi, activateAutomationApi, deactivateAutomationApi, runAutomationApi } from '../../lib/api';
import { Button } from '../ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Badge } from '../ui/badge';
import { Input } from '../ui/input';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../ui/table';
import { Cpu, Play } from 'lucide-react';

interface AutomationsPanelProps {
  automations: AdminAutomation[];
  onError: (message: string) => void;
  onMessage: (message: string) => void;
  onChanged: () => Promise<void>;
}

export function AutomationsPanel({ automations, onError, onMessage, onChanged }: AutomationsPanelProps) {
  const [autoKey, setAutoKey] = useState('');
  const [autoName, setAutoName] = useState('');
  const [autoTrigger] = useState('comment.created');
  const [autoActionType] = useState('webhook');
  const [autoActionUrl, setAutoActionUrl] = useState('');

  const handleCreateAutomation = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createAutomationApi({
        key: autoKey,
        name: autoName,
        triggerEvent: autoTrigger,
        actions: [{ type: autoActionType, config: { url: autoActionUrl } }],
      });
      setAutoKey('');
      setAutoName('');
      setAutoActionUrl('');
      onMessage('Automation created');
      await onChanged();
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : 'Failed');
    }
  };

  const handleToggleAutomation = async (a: AdminAutomation) => {
    try {
      if (a.status === 'active') {
        await deactivateAutomationApi(a.id);
      } else {
        await activateAutomationApi(a.id);
      }
      await onChanged();
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : 'Failed');
    }
  };

  const handleRunAutomationNow = async (id: string) => {
    try {
      await runAutomationApi(id);
      onMessage('Automation test execution triggered');
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : 'Failed');
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <Card className="lg:col-span-1 h-fit bg-transparent border-border shadow-2xs">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-bold flex items-center gap-2 text-foreground">
            <Cpu className="h-4 w-4 text-primary" /> New Automation Workflow
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreateAutomation} className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-foreground">Workflow Key</label>
              <Input required value={autoKey} onChange={(e) => setAutoKey(e.target.value)} placeholder="auto-slack-notify" className="h-8 text-xs font-mono bg-card border-border" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-foreground">Workflow Name</label>
              <Input required value={autoName} onChange={(e) => setAutoName(e.target.value)} placeholder="Slack Notification on Comment" className="h-8 text-xs bg-card border-border" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-foreground">Target Webhook URL</label>
              <Input required type="url" value={autoActionUrl} onChange={(e) => setAutoActionUrl(e.target.value)} placeholder="https://hooks.slack.com/services/..." className="h-8 text-xs font-mono bg-card border-border" />
            </div>
            <Button type="submit" size="sm" className="w-full h-8 text-xs font-semibold bg-primary hover:bg-primary/90 text-primary-foreground mt-2">
              Create Automation
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="lg:col-span-2 bg-transparent border-border shadow-2xs p-0 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-border">
              <TableHead className="pl-6 text-xs">Name</TableHead>
              <TableHead className="text-xs">Trigger</TableHead>
              <TableHead className="text-xs">Status</TableHead>
              <TableHead className="text-right pr-6 text-xs">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {automations.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="h-32 text-center text-xs text-muted-foreground">
                  No automated workflows created.
                </TableCell>
              </TableRow>
            ) : (
              automations.map((a) => (
                <TableRow key={a.id} className="hover:bg-muted/40 border-border">
                  <TableCell className="pl-6 font-semibold text-xs text-foreground">{a.name}</TableCell>
                  <TableCell className="text-xs font-mono text-muted-foreground">{a.triggerEvent}</TableCell>
                  <TableCell>
                    {a.status === 'active' ? (
                      <Badge variant="outline" className="text-[10px] font-mono px-2 py-0.5 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20">
                        Active
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px] font-mono px-2 py-0.5 bg-muted text-muted-foreground border-border">
                        Disabled
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right pr-6">
                    <div className="flex items-center justify-end gap-1.5">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleToggleAutomation(a)}
                        className="h-7 text-xs border-border bg-card hover:bg-accent text-foreground"
                      >
                        {a.status === 'active' ? 'Deactivate' : 'Activate'}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRunAutomationNow(a.id)}
                        className="h-7 px-2 text-xs gap-1 text-muted-foreground hover:text-foreground"
                      >
                        <Play className="h-3 w-3" /> Test
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}