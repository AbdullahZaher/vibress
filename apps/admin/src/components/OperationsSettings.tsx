import { useEffect, useState } from 'react';
import {
  AdminSettingValue,
  AdminAuditEvent,
  AdminRedirect,
  AdminImportExportJob,
  getStaffSettingsApi,
  listAuditApi,
  listRedirectsApi,
  listJobsApi,
  getDiagnosticsApi,
} from '../lib/api';

import { Cpu, ShieldCheck, ArrowRightLeft, Download, Wrench } from 'lucide-react';
import { StaffSettingsPanel } from './operations/StaffSettingsPanel';
import { AuditLogPanel } from './operations/AuditLogPanel';
import { RedirectsPanel } from './operations/RedirectsPanel';
import { TransferPanel } from './operations/TransferPanel';
import { SystemPanel } from './operations/SystemPanel';

type Tab = 'settings' | 'audit' | 'redirects' | 'transfer' | 'system';

export function OperationsSettings() {
  const [tab, setTab] = useState<Tab>('settings');
  const [settings, setSettings] = useState<Array<{ namespace: string; settings: AdminSettingValue[] }>>([]);
  const [audit, setAudit] = useState<AdminAuditEvent[]>([]);
  const [redirects, setRedirects] = useState<AdminRedirect[]>([]);
  const [jobs, setJobs] = useState<AdminImportExportJob[]>([]);
  const [diagnostics, setDiagnostics] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const [s, a, r, j, d] = await Promise.all([
        getStaffSettingsApi(),
        listAuditApi({ limit: 30 }),
        listRedirectsApi(),
        listJobsApi(),
        getDiagnosticsApi(),
      ]);
      setSettings(s.namespaces);
      setAudit(a.events);
      setRedirects(r.redirects);
      setJobs(j.jobs);
      setDiagnostics(d.diagnostics);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load operations data');
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  return (
    <div className="space-y-8 w-full max-w-7xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold tracking-tight text-foreground">System & Operations</h1>
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
          onClick={() => setTab('settings')}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer ${
            tab === 'settings'
              ? 'bg-card text-foreground border border-border shadow-2xs font-semibold'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Cpu className="h-3.5 w-3.5" /> Staff Settings
        </button>
        <button
          onClick={() => setTab('audit')}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer ${
            tab === 'audit'
              ? 'bg-card text-foreground border border-border shadow-2xs font-semibold'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <ShieldCheck className="h-3.5 w-3.5" /> Audit Log ({audit.length})
        </button>
        <button
          onClick={() => setTab('redirects')}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer ${
            tab === 'redirects'
              ? 'bg-card text-foreground border border-border shadow-2xs font-semibold'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <ArrowRightLeft className="h-3.5 w-3.5" /> URL Redirects ({redirects.length})
        </button>
        <button
          onClick={() => setTab('transfer')}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer ${
            tab === 'transfer'
              ? 'bg-card text-foreground border border-border shadow-2xs font-semibold'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Download className="h-3.5 w-3.5" /> Import & Export
        </button>
        <button
          onClick={() => setTab('system')}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer ${
            tab === 'system'
              ? 'bg-card text-foreground border border-border shadow-2xs font-semibold'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Wrench className="h-3.5 w-3.5" /> Maintenance & System
        </button>
      </div>

      {/* Panels stay mounted so form state survives tab switches */}
      <div className={tab === 'settings' ? '' : 'hidden'}>
        <StaffSettingsPanel settings={settings} onError={setError} onMessage={setMessage} onChanged={refresh} />
      </div>
      <div className={tab === 'audit' ? '' : 'hidden'}>
        <AuditLogPanel audit={audit} />
      </div>
      <div className={tab === 'redirects' ? '' : 'hidden'}>
        <RedirectsPanel redirects={redirects} onError={setError} onMessage={setMessage} onChanged={refresh} />
      </div>
      <div className={tab === 'transfer' ? '' : 'hidden'}>
        <TransferPanel jobs={jobs} onError={setError} onMessage={setMessage} onChanged={refresh} />
      </div>
      <div className={tab === 'system' ? '' : 'hidden'}>
        <SystemPanel diagnostics={diagnostics} onError={setError} onMessage={setMessage} onChanged={refresh} />
      </div>
    </div>
  );
}