import React, { useEffect, useState } from 'react';
import {
  AdminSettingValue,
  AdminAuditEvent,
  AdminRedirect,
  AdminImportExportJob,
  getStaffSettingsApi,
  updateSettingApi,
  listAuditApi,
  listRedirectsApi,
  createRedirectApi,
  deleteRedirectApi,
  createExportApi,
  listJobsApi,
  getDiagnosticsApi,
  runMaintenanceApi,
} from '../lib/api';

import { Button } from './ui/button';
import { Card, CardHeader, CardTitle, CardContent } from './ui/card';
import { Badge } from './ui/badge';
import { Input } from './ui/input';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from './ui/table';
import { Cpu, ShieldCheck, ArrowRightLeft, Download, Wrench } from 'lucide-react';

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

  // Redirect form
  const [rdSource, setRdSource] = useState('');
  const [rdDest, setRdDest] = useState('');
  const [rdCode, setRdCode] = useState('301');

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

  const handleUpdateSetting = async (namespace: string, key: string, value: unknown) => {
    try {
      await updateSettingApi(namespace, key, value);
      setMessage(`Setting "${key}" updated`);
      await refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  };

  const handleCreateRedirect = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createRedirectApi({ source: rdSource, destination: rdDest, statusCode: parseInt(rdCode, 10) || 301 });
      setRdSource('');
      setRdDest('');
      setMessage('Redirect rule created');
      await refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  };

  const handleDeleteRedirect = async (id: string) => {
    try {
      await deleteRedirectApi(id);
      setMessage('Redirect rule deleted');
      await refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  };

  const handleTriggerExport = async () => {
    try {
      await createExportApi();
      setMessage('Publication export task queued');
      await refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  };

  const handleRunMaintenance = async (task: string) => {
    try {
      await runMaintenanceApi(task);
      setMessage(`Maintenance task "${task}" executed.`);
      await refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  };

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

      {/* Tab 1: Staff Settings */}
      {tab === 'settings' && (
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
      )}

      {/* Tab 2: Audit Logs */}
      {tab === 'audit' && (
        <Card className="bg-transparent border-border shadow-2xs p-0 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="border-border">
                <TableHead className="pl-6 text-xs">Timestamp</TableHead>
                <TableHead className="text-xs">Actor</TableHead>
                <TableHead className="text-xs">Action</TableHead>
                <TableHead className="text-right pr-6 text-xs">Resource</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {audit.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="h-32 text-center text-xs text-muted-foreground">
                    No audit log events recorded.
                  </TableCell>
                </TableRow>
              ) : (
                audit.map((ev) => (
                  <TableRow key={ev.id} className="hover:bg-muted/40 border-border text-xs">
                    <TableCell className="pl-6 font-mono text-muted-foreground">
                      {new Date(ev.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell className="font-semibold text-foreground">{ev.actorUserId || 'System'}</TableCell>
                    <TableCell className="font-mono text-emerald-500 font-semibold">{ev.action}</TableCell>
                    <TableCell className="text-right pr-6 font-mono text-muted-foreground">{ev.targetType}:{ev.targetId}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Card>
      )}

      {/* Tab 3: URL Redirects */}
      {tab === 'redirects' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-1 h-fit bg-transparent border-border shadow-2xs">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-bold flex items-center gap-2 text-foreground">
                <ArrowRightLeft className="h-4 w-4 text-primary" /> New Redirect Rule
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleCreateRedirect} className="space-y-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-foreground">Source Path</label>
                  <Input required value={rdSource} onChange={(e) => setRdSource(e.target.value)} placeholder="/old-post" className="h-8 text-xs font-mono bg-card border-border" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-foreground">Destination Path / URL</label>
                  <Input required value={rdDest} onChange={(e) => setRdDest(e.target.value)} placeholder="/new-post" className="h-8 text-xs font-mono bg-card border-border" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-foreground">HTTP Status Code</label>
                  <select value={rdCode} onChange={(e) => setRdCode(e.target.value)} className="w-full h-8 text-xs bg-card border border-border rounded-md px-2 text-foreground">
                    <option value="301">301 (Permanent)</option>
                    <option value="302">302 (Temporary)</option>
                  </select>
                </div>
                <Button type="submit" size="sm" className="w-full h-8 text-xs font-semibold bg-primary hover:bg-primary/90 text-primary-foreground mt-2">
                  Create Redirect
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card className="lg:col-span-2 bg-transparent border-border shadow-2xs p-0 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="border-border">
                  <TableHead className="pl-6 text-xs">Source Path</TableHead>
                  <TableHead className="text-xs">Destination</TableHead>
                  <TableHead className="text-xs">Code</TableHead>
                  <TableHead className="text-right pr-6 text-xs">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {redirects.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="h-32 text-center text-xs text-muted-foreground">
                      No redirect rules defined.
                    </TableCell>
                  </TableRow>
                ) : (
                  redirects.map((r) => (
                    <TableRow key={r.id} className="hover:bg-muted/40 border-border">
                      <TableCell className="pl-6 font-mono text-xs text-foreground">{r.source}</TableCell>
                      <TableCell className="text-xs font-mono text-muted-foreground">{r.destination}</TableCell>
                      <TableCell className="text-xs font-mono font-semibold text-emerald-500">{r.statusCode}</TableCell>
                      <TableCell className="text-right pr-6">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeleteRedirect(r.id)}
                          className="h-7 px-2 text-xs text-red-600 dark:text-red-400 hover:bg-red-500/10"
                        >
                          Delete
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Card>
        </div>
      )}

      {/* Tab 4: Import & Export */}
      {tab === 'transfer' && (
        <div className="space-y-6">
          <Card className="p-6 bg-transparent border-border shadow-2xs flex items-center justify-between">
            <div>
              <h3 className="font-bold text-sm text-foreground">Full Publication Data Backup</h3>
              <p className="text-xs text-muted-foreground pt-0.5">Export all posts, pages, tags, members, and configuration settings in JSON format.</p>
            </div>
            <Button
              onClick={handleTriggerExport}
              className="h-8 text-xs font-semibold bg-primary hover:bg-primary/90 text-primary-foreground gap-1.5"
            >
              <Download className="h-3.5 w-3.5" /> Export All Data
            </Button>
          </Card>

          <Card className="bg-transparent border-border shadow-2xs p-0 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="border-border">
                  <TableHead className="pl-6 text-xs">Job Type</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                  <TableHead className="text-right pr-6 text-xs">Created At</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="h-32 text-center text-xs text-muted-foreground">
                      No background data jobs executed yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  jobs.map((j) => (
                    <TableRow key={j.id} className="hover:bg-muted/40 border-border text-xs">
                      <TableCell className="pl-6 font-semibold text-foreground capitalize">{j.type}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px] font-mono px-2 py-0.5 bg-muted text-muted-foreground border-border">
                          {j.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right pr-6 font-mono text-muted-foreground">{new Date(j.createdAt).toLocaleString()}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Card>
        </div>
      )}

      {/* Tab 5: Maintenance & System */}
      {tab === 'system' && (
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
      )}
    </div>
  );
}
