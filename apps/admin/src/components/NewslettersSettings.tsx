import React, { useEffect, useState } from 'react';
import {
  AdminNewsletter,
  AdminNewsletterSend,
  AdminSuppression,
  listNewslettersApi,
  createNewsletterApi,
  archiveNewsletterApi,
  listNewsletterSendsApi,
  createNewsletterSendApi,
  sendNewsletterNowApi,
  cancelNewsletterSendApi,
  listSuppressionsApi,
  removeSuppressionApi,
} from '../lib/api';

import { Button } from './ui/button';
import { Card, CardHeader, CardTitle, CardContent } from './ui/card';
import { Badge } from './ui/badge';
import { Input } from './ui/input';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from './ui/table';
import { Mail, Send, ShieldX, Play, Ban } from 'lucide-react';

type Tab = 'newsletters' | 'sends' | 'suppressions';

export function NewslettersSettings() {
  const [tab, setTab] = useState<Tab>('newsletters');
  const [newsletters, setNewsletters] = useState<AdminNewsletter[]>([]);
  const [sends, setSends] = useState<AdminNewsletterSend[]>([]);
  const [suppressions, setSuppressions] = useState<AdminSuppression[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // Forms
  const [nlKey, setNlKey] = useState('');
  const [nlName, setNlName] = useState('');
  const [sendNlId, setSendNlId] = useState('');
  const [sendSubject, setSendSubject] = useState('');

  const refresh = async () => {
    try {
      const [n, s, sup] = await Promise.all([
        listNewslettersApi(true),
        listNewsletterSendsApi(),
        listSuppressionsApi(),
      ]);
      setNewsletters(n.newsletters);
      setSends(s.sends);
      setSuppressions(sup.suppressions);
      if (n.newsletters.length > 0 && n.newsletters[0] && !sendNlId) {
        setSendNlId(n.newsletters[0].id);
      }
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load newsletters');
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const handleCreateNewsletter = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createNewsletterApi({
        key: nlKey,
        name: nlName,
        senderName: 'Vibress',
        senderEmail: 'noreply@vibress.local',
      });
      setNlKey('');
      setNlName('');
      setMessage('Newsletter created');
      await refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  };

  const handleArchiveNewsletter = async (id: string) => {
    try {
      await archiveNewsletterApi(id);
      setMessage('Newsletter archived');
      await refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  };

  const handleCreateSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sendNlId) return;
    try {
      await createNewsletterSendApi({
        newsletterId: sendNlId,
        subject: sendSubject,
        content: { type: 'doc', content: [] },
        audience: { filter: 'all' },
      });
      setSendSubject('');
      setMessage('Broadcast created');
      await refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  };

  const handleSendNow = async (id: string) => {
    try {
      await sendNewsletterNowApi(id);
      setMessage('Newsletter dispatch initiated');
      await refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  };

  const handleCancelSend = async (id: string) => {
    try {
      await cancelNewsletterSendApi(id);
      setMessage('Newsletter dispatch canceled');
      await refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  };

  const handleRemoveSuppression = async (email: string) => {
    try {
      await removeSuppressionApi(email);
      setMessage('Suppression removed');
      await refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  };

  return (
    <div className="space-y-8 w-full max-w-7xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold tracking-tight text-foreground">Newsletters & Email Broadcasts</h1>
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
          onClick={() => setTab('newsletters')}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer ${
            tab === 'newsletters'
              ? 'bg-card text-foreground border border-border shadow-2xs font-semibold'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Mail className="h-3.5 w-3.5" /> Newsletters ({newsletters.length})
        </button>
        <button
          onClick={() => setTab('sends')}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer ${
            tab === 'sends'
              ? 'bg-card text-foreground border border-border shadow-2xs font-semibold'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Send className="h-3.5 w-3.5" /> Broadcasts ({sends.length})
        </button>
        <button
          onClick={() => setTab('suppressions')}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer ${
            tab === 'suppressions'
              ? 'bg-card text-foreground border border-border shadow-2xs font-semibold'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <ShieldX className="h-3.5 w-3.5" /> Suppressions ({suppressions.length})
        </button>
      </div>

      {/* Tab 1: Newsletters */}
      {tab === 'newsletters' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-1 h-fit bg-transparent border-border shadow-2xs">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-bold flex items-center gap-2 text-foreground">
                <Mail className="h-4 w-4 text-primary" /> New Newsletter
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleCreateNewsletter} className="space-y-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-foreground">Slug / Key</label>
                  <Input required value={nlKey} onChange={(e) => setNlKey(e.target.value)} placeholder="weekly-digest" className="h-8 text-xs font-mono bg-card border-border" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-foreground">Newsletter Name</label>
                  <Input required value={nlName} onChange={(e) => setNlName(e.target.value)} placeholder="Weekly Engineering Digest" className="h-8 text-xs bg-card border-border" />
                </div>
                <Button type="submit" size="sm" className="w-full h-8 text-xs font-semibold bg-primary hover:bg-primary/90 text-primary-foreground mt-2">
                  Create Newsletter
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card className="lg:col-span-2 bg-transparent border-border shadow-2xs p-0 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="border-border">
                  <TableHead className="pl-6 text-xs">Newsletter Name</TableHead>
                  <TableHead className="text-xs">Slug</TableHead>
                  <TableHead className="text-[10px] text-muted-foreground font-mono">Sender</TableHead>
                  <TableHead className="text-right pr-6 text-xs">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {newsletters.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="h-32 text-center text-xs text-muted-foreground">
                      No newsletters configured.
                    </TableCell>
                  </TableRow>
                ) : (
                  newsletters.map((n) => (
                    <TableRow key={n.id} className="hover:bg-muted/40 border-border">
                      <TableCell className="pl-6 font-semibold text-xs text-foreground">{n.name}</TableCell>
                      <TableCell className="text-xs font-mono text-muted-foreground">{n.key}</TableCell>
                      <TableCell className="text-xs text-muted-foreground font-mono">{n.senderEmail}</TableCell>
                      <TableCell className="text-right pr-6">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleArchiveNewsletter(n.id)}
                          className="h-7 px-2 text-xs text-red-600 dark:text-red-400 hover:bg-red-500/10"
                        >
                          Archive
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

      {/* Tab 2: Broadcast Sends */}
      {tab === 'sends' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-1 h-fit bg-transparent border-border shadow-2xs">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-bold flex items-center gap-2 text-foreground">
                <Send className="h-4 w-4 text-primary" /> New Broadcast
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleCreateSend} className="space-y-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-foreground">Select Newsletter</label>
                  <select
                    value={sendNlId}
                    onChange={(e) => setSendNlId(e.target.value)}
                    className="w-full h-8 text-xs bg-card border border-border rounded-md px-2 text-foreground font-medium"
                  >
                    {newsletters.map((n) => (
                      <option key={n.id} value={n.id}>{n.name}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-foreground">Subject Line</label>
                  <Input required value={sendSubject} onChange={(e) => setSendSubject(e.target.value)} placeholder="Issue #10: Monorepos Unleashed" className="h-8 text-xs bg-card border-border" />
                </div>
                <Button type="submit" size="sm" className="w-full h-8 text-xs font-semibold bg-primary hover:bg-primary/90 text-primary-foreground mt-2">
                  Create Draft Broadcast
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card className="lg:col-span-2 bg-transparent border-border shadow-2xs p-0 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="border-border">
                  <TableHead className="pl-6 text-xs">Subject</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                  <TableHead className="text-right pr-6 text-xs">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sends.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="h-32 text-center text-xs text-muted-foreground">
                      No broadcast sends recorded.
                    </TableCell>
                  </TableRow>
                ) : (
                  sends.map((s) => (
                    <TableRow key={s.id} className="hover:bg-muted/40 border-border">
                      <TableCell className="pl-6 font-semibold text-xs text-foreground">{s.subject}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px] font-mono px-2 py-0.5 bg-muted text-muted-foreground border-border">
                          {s.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right pr-6">
                        <div className="flex items-center justify-end gap-1.5">
                          {s.status === 'draft' && (
                            <Button
                              size="sm"
                              onClick={() => handleSendNow(s.id)}
                              className="h-7 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white gap-1"
                            >
                              <Play className="h-3 w-3" /> Dispatch Now
                            </Button>
                          )}
                          {s.status === 'scheduled' && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleCancelSend(s.id)}
                              className="h-7 text-xs border-red-500/20 text-red-600 hover:bg-red-500/10 gap-1"
                            >
                              <Ban className="h-3 w-3" /> Cancel
                            </Button>
                          )}
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

      {/* Tab 3: Suppressions */}
      {tab === 'suppressions' && (
        <Card className="bg-transparent border-border shadow-2xs p-0 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="border-border">
                <TableHead className="pl-6 text-xs">Suppressed Email</TableHead>
                <TableHead className="text-xs">Reason</TableHead>
                <TableHead className="text-right pr-6 text-xs">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {suppressions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="h-32 text-center text-xs text-muted-foreground">
                    No email suppressions recorded.
                  </TableCell>
                </TableRow>
              ) : (
                suppressions.map((sup) => (
                  <TableRow key={sup.id} className="hover:bg-muted/40 border-border">
                    <TableCell className="pl-6 font-mono text-xs text-foreground">{sup.email}</TableCell>
                    <TableCell className="text-xs font-mono text-muted-foreground">{sup.reason}</TableCell>
                    <TableCell className="text-right pr-6">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRemoveSuppression(sup.email)}
                        className="h-7 px-2 text-xs text-red-600 dark:text-red-400 hover:bg-red-500/10"
                      >
                        Remove
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
