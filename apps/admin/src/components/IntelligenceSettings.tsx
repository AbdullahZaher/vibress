import React, { useEffect, useState } from 'react';
import {
  AdminMetric,
  AdminAutomation,
  getAnalyticsMetricsApi,
  rebuildSearchIndexApi,
  getSearchIndexCountApi,
  listAutomationsApi,
  createAutomationApi,
  activateAutomationApi,
  deactivateAutomationApi,
  runAutomationApi,
} from '../lib/api';

import { Button } from './ui/button';
import { Card, CardHeader, CardTitle, CardContent } from './ui/card';
import { Badge } from './ui/badge';
import { Input } from './ui/input';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from './ui/table';
import { Activity, Search, Cpu, Play, RefreshCw } from 'lucide-react';

type Tab = 'analytics' | 'search' | 'automations';

export function IntelligenceSettings() {
  const [tab, setTab] = useState<Tab>('analytics');
  const [metrics, setMetrics] = useState<AdminMetric[]>([]);
  const [metricsRange, setMetricsRange] = useState({ from: '', to: '' });
  const [indexCount, setIndexCount] = useState(0);
  const [automations, setAutomations] = useState<AdminAutomation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [indexing, setIndexing] = useState(false);

  // Form
  const [autoKey, setAutoKey] = useState('');
  const [autoName, setAutoName] = useState('');
  const [autoTrigger] = useState('comment.created');
  const [autoActionType] = useState('webhook');
  const [autoActionUrl, setAutoActionUrl] = useState('');

  const refreshAnalytics = async () => {
    try {
      const from = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
      const to = new Date().toISOString().slice(0, 10);
      const res = await getAnalyticsMetricsApi({ from, to });
      setMetrics(res.metrics);
      setMetricsRange({ from, to });
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  };

  const refreshAutomations = async () => {
    try {
      const a = await listAutomationsApi();
      setAutomations(a.automations);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  };

  const refreshSearch = async () => {
    try {
      const res = await getSearchIndexCountApi();
      setIndexCount(res.count);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  };

  useEffect(() => {
    setError(null);
    setMessage(null);
    if (tab === 'analytics') refreshAnalytics();
    if (tab === 'search') refreshSearch();
    if (tab === 'automations') refreshAutomations();
  }, [tab]);

  const handleRebuildSearch = async () => {
    setIndexing(true);
    try {
      await rebuildSearchIndexApi();
      setMessage('Search index rebuild initiated successfully.');
      await refreshSearch();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Search rebuild failed');
    } finally {
      setIndexing(false);
    }
  };

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
      setMessage('Automation created');
      await refreshAutomations();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  };

  const handleToggleAutomation = async (a: AdminAutomation) => {
    try {
      if (a.status === 'active') {
        await deactivateAutomationApi(a.id);
      } else {
        await activateAutomationApi(a.id);
      }
      await refreshAutomations();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  };

  const handleRunAutomationNow = async (id: string) => {
    try {
      await runAutomationApi(id);
      setMessage('Automation test execution triggered');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  };

  return (
    <div className="space-y-8 w-full max-w-7xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold tracking-tight text-foreground">Intelligence & Workflow Engine</h1>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 text-xs font-medium">
          {error}
        </div>
      )}

      {message && (
        <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs font-medium">
          {message}
        </div>
      )}

      {/* Tabs Bar */}
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => setTab('analytics')}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer ${
            tab === 'analytics'
              ? 'bg-card text-foreground border border-border shadow-2xs font-semibold'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Activity className="h-3.5 w-3.5" /> Analytics Engine
        </button>
        <button
          onClick={() => setTab('search')}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer ${
            tab === 'search'
              ? 'bg-card text-foreground border border-border shadow-2xs font-semibold'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Search className="h-3.5 w-3.5" /> Full-Text Search
        </button>
        <button
          onClick={() => setTab('automations')}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer ${
            tab === 'automations'
              ? 'bg-card text-foreground border border-border shadow-2xs font-semibold'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Cpu className="h-3.5 w-3.5" /> Workflows & Automations ({automations.length})
        </button>
      </div>

      {/* Tab 1: Analytics Metrics */}
      {tab === 'analytics' && (
        <Card className="bg-transparent border-border shadow-2xs p-0 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="border-border">
                <TableHead className="pl-6 text-xs">Metric Date</TableHead>
                <TableHead className="text-xs">Metric Name</TableHead>
                <TableHead className="text-right pr-6 text-xs">Total Count</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {metrics.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="h-32 text-center text-xs text-muted-foreground">
                    No analytics metrics aggregated for timeframe ({metricsRange.from} - {metricsRange.to}).
                  </TableCell>
                </TableRow>
              ) : (
                metrics.map((m, idx) => (
                  <TableRow key={idx} className="hover:bg-muted/40 border-border font-mono text-xs">
                    <TableCell className="pl-6 font-medium text-foreground">{m.date}</TableCell>
                    <TableCell className="text-muted-foreground">{m.name}</TableCell>
                    <TableCell className="text-right pr-6 text-foreground font-semibold">{m.count}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Card>
      )}

      {/* Tab 2: Search Indexing */}
      {tab === 'search' && (
        <Card className="p-6 bg-transparent border-border shadow-2xs space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h3 className="font-bold text-sm text-foreground">Search Index Status</h3>
              <p className="text-xs text-muted-foreground font-mono pt-0.5">Indexed Documents: {indexCount}</p>
            </div>
            <Button
              disabled={indexing}
              onClick={handleRebuildSearch}
              className="h-8 text-xs font-semibold bg-primary hover:bg-primary/90 text-primary-foreground gap-1.5"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${indexing ? 'animate-spin' : ''}`} />
              {indexing ? 'Rebuilding Index...' : 'Rebuild Search Index'}
            </Button>
          </div>
        </Card>
      )}

      {/* Tab 3: Automations */}
      {tab === 'automations' && (
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
      )}
    </div>
  );
}
