import { useEffect, useState } from 'react';
import {
  AdminMetric,
  AdminAutomation,
  getAnalyticsMetricsApi,
  getSearchIndexCountApi,
  listAutomationsApi,
} from '../lib/api';

import { Activity, Search, Cpu } from 'lucide-react';
import { AnalyticsPanel } from './intelligence/AnalyticsPanel';
import { SearchIndexPanel } from './intelligence/SearchIndexPanel';
import { AutomationsPanel } from './intelligence/AutomationsPanel';

type Tab = 'analytics' | 'search' | 'automations';

export function IntelligenceSettings() {
  const [tab, setTab] = useState<Tab>('analytics');
  const [metrics, setMetrics] = useState<AdminMetric[]>([]);
  const [metricsRange, setMetricsRange] = useState({ from: '', to: '' });
  const [indexCount, setIndexCount] = useState(0);
  const [automations, setAutomations] = useState<AdminAutomation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

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

      {/* Panels stay mounted so form state survives tab switches */}
      <div className={tab === 'analytics' ? '' : 'hidden'}>
        <AnalyticsPanel metrics={metrics} metricsRange={metricsRange} />
      </div>
      <div className={tab === 'search' ? '' : 'hidden'}>
        <SearchIndexPanel indexCount={indexCount} onError={setError} onMessage={setMessage} onChanged={refreshSearch} />
      </div>
      <div className={tab === 'automations' ? '' : 'hidden'}>
        <AutomationsPanel automations={automations} onError={setError} onMessage={setMessage} onChanged={refreshAutomations} />
      </div>
    </div>
  );
}