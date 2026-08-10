import React, { useEffect, useState } from 'react';
import {
  AdminIntegration,
  AdminApiKey,
  AdminWebhookEndpoint,
  AdminPlugin,
  listIntegrationsApi,
  createIntegrationApi,
  listApiKeysApi,
  createApiKeyApi,
  revokeApiKeyApi,
  listWebhookEndpointsApi,
  createWebhookEndpointApi,
  deleteWebhookEndpointApi,
  listPluginsApi,
  activatePluginApi,
  deactivatePluginApi,
} from '../lib/api';

import { Button } from './ui/button';
import { Card, CardHeader, CardTitle, CardContent } from './ui/card';
import { Badge } from './ui/badge';
import { Input } from './ui/input';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from './ui/table';
import { Server, Key, Webhook, Puzzle } from 'lucide-react';

type Tab = 'integrations' | 'apikeys' | 'webhooks' | 'plugins';

export function PlatformSettings() {
  const [tab, setTab] = useState<Tab>('integrations');
  const [integrations, setIntegrations] = useState<AdminIntegration[]>([]);
  const [apiKeys, setApiKeys] = useState<AdminApiKey[]>([]);
  const [webhooks, setWebhooks] = useState<AdminWebhookEndpoint[]>([]);
  const [plugins, setPlugins] = useState<AdminPlugin[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [newSecret, setNewSecret] = useState<string | null>(null);

  // Form states
  const [intKey, setIntKey] = useState('');
  const [intName, setIntName] = useState('');
  const [keyName, setKeyName] = useState('');
  const [whName, setWhName] = useState('');
  const [whUrl, setWhUrl] = useState('');
  const [whEvents, setWhEvents] = useState('post.published,member.created');
  const [whSecret, setWhSecret] = useState('');

  const refresh = async () => {
    try {
      const [i, k, w, p] = await Promise.all([
        listIntegrationsApi(),
        listApiKeysApi(),
        listWebhookEndpointsApi(),
        listPluginsApi(),
      ]);
      setIntegrations(i.integrations);
      setApiKeys(k.keys);
      setWebhooks(w.endpoints);
      setPlugins(p.plugins);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load platform data');
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const handleCreateIntegration = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createIntegrationApi({ key: intKey, type: 'custom', name: intName });
      setIntKey('');
      setIntName('');
      setMessage('Integration created');
      await refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed');
    }
  };

  const handleCreateApiKey = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await createApiKeyApi({ name: keyName, scopes: ['*'] });
      setKeyName('');
      setNewSecret(res.key.secret || null);
      setMessage('API Key generated successfully. Copy the secret now!');
      await refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed');
    }
  };

  const handleRevokeApiKey = async (id: string) => {
    try {
      await revokeApiKeyApi(id);
      setMessage('API key revoked');
      await refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed');
    }
  };

  const handleCreateWebhook = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createWebhookEndpointApi({
        name: whName,
        url: whUrl,
        eventTypes: whEvents.split(',').map((x) => x.trim()),
        secret: whSecret || 'whsec_default_secret',
      });
      setWhName('');
      setWhUrl('');
      setWhSecret('');
      setMessage('Webhook endpoint added');
      await refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed');
    }
  };

  const handleDeleteWebhook = async (id: string) => {
    try {
      await deleteWebhookEndpointApi(id);
      setMessage('Webhook endpoint deleted');
      await refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed');
    }
  };

  const handleTogglePlugin = async (p: AdminPlugin) => {
    try {
      if (p.status === 'active') {
        await deactivatePluginApi(p.id);
      } else {
        await activatePluginApi(p.id);
      }
      await refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed');
    }
  };

  return (
    <div className="space-y-8 w-full max-w-7xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold tracking-tight text-foreground">Integrations & Developer Platform</h1>
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

      {newSecret && (
        <div className="p-4 rounded-lg bg-card border border-primary text-xs font-mono space-y-1">
          <p className="text-primary font-bold font-sans">API Key Secret (Save this now!):</p>
          <p className="select-all text-foreground font-bold">{newSecret}</p>
        </div>
      )}

      {/* Tabs Bar */}
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => setTab('integrations')}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer ${
            tab === 'integrations'
              ? 'bg-card text-foreground border border-border shadow-2xs font-semibold'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Server className="h-3.5 w-3.5" /> Integrations ({integrations.length})
        </button>
        <button
          onClick={() => setTab('apikeys')}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer ${
            tab === 'apikeys'
              ? 'bg-card text-foreground border border-border shadow-2xs font-semibold'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Key className="h-3.5 w-3.5" /> API Keys ({apiKeys.length})
        </button>
        <button
          onClick={() => setTab('webhooks')}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer ${
            tab === 'webhooks'
              ? 'bg-card text-foreground border border-border shadow-2xs font-semibold'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Webhook className="h-3.5 w-3.5" /> Webhooks ({webhooks.length})
        </button>
        <button
          onClick={() => setTab('plugins')}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer ${
            tab === 'plugins'
              ? 'bg-card text-foreground border border-border shadow-2xs font-semibold'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Puzzle className="h-3.5 w-3.5" /> Plugins ({plugins.length})
        </button>
      </div>

      {/* Tab 1: Integrations */}
      {tab === 'integrations' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-1 h-fit bg-transparent border-border shadow-2xs">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-bold flex items-center gap-2 text-foreground">
                <Server className="h-4 w-4 text-primary" /> New Integration
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleCreateIntegration} className="space-y-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-foreground">Slug / Key</label>
                  <Input required value={intKey} onChange={(e) => setIntKey(e.target.value)} placeholder="zapier-connector" className="h-8 text-xs font-mono bg-card border-border" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-foreground">Integration Name</label>
                  <Input required value={intName} onChange={(e) => setIntName(e.target.value)} placeholder="Zapier Automation" className="h-8 text-xs bg-card border-border" />
                </div>
                <Button type="submit" size="sm" className="w-full h-8 text-xs font-semibold bg-primary hover:bg-primary/90 text-primary-foreground mt-2">
                  Create Integration
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card className="lg:col-span-2 bg-transparent border-border shadow-2xs p-0 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="border-border">
                  <TableHead className="pl-6 text-xs">Name</TableHead>
                  <TableHead className="text-xs">Key</TableHead>
                  <TableHead className="text-xs">Type</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {integrations.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="h-32 text-center text-xs text-muted-foreground">
                      No custom integrations added.
                    </TableCell>
                  </TableRow>
                ) : (
                  integrations.map((i) => (
                    <TableRow key={i.id} className="hover:bg-muted/40 border-border">
                      <TableCell className="pl-6 font-semibold text-xs text-foreground">{i.name}</TableCell>
                      <TableCell className="text-xs font-mono text-muted-foreground">{i.key}</TableCell>
                      <TableCell className="text-xs font-mono capitalize">{i.type}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Card>
        </div>
      )}

      {/* Tab 2: API Keys */}
      {tab === 'apikeys' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-1 h-fit bg-transparent border-border shadow-2xs">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-bold flex items-center gap-2 text-foreground">
                <Key className="h-4 w-4 text-primary" /> Generate API Key
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleCreateApiKey} className="space-y-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-foreground">Key Name / Description</label>
                  <Input required value={keyName} onChange={(e) => setKeyName(e.target.value)} placeholder="GitHub Actions Deployment Key" className="h-8 text-xs bg-card border-border" />
                </div>
                <Button type="submit" size="sm" className="w-full h-8 text-xs font-semibold bg-primary hover:bg-primary/90 text-primary-foreground mt-2">
                  Generate Key
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card className="lg:col-span-2 bg-transparent border-border shadow-2xs p-0 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="border-border">
                  <TableHead className="pl-6 text-xs">Name</TableHead>
                  <TableHead className="text-xs">Access Key Prefix</TableHead>
                  <TableHead className="text-right pr-6 text-xs">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {apiKeys.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="h-32 text-center text-xs text-muted-foreground">
                      No API keys generated.
                    </TableCell>
                  </TableRow>
                ) : (
                  apiKeys.map((k) => (
                    <TableRow key={k.id} className="hover:bg-muted/40 border-border">
                      <TableCell className="pl-6 font-semibold text-xs text-foreground">{k.name}</TableCell>
                      <TableCell className="text-xs font-mono text-muted-foreground">{k.prefix}</TableCell>
                      <TableCell className="text-right pr-6">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRevokeApiKey(k.id)}
                          className="h-7 px-2 text-xs text-red-600 dark:text-red-400 hover:bg-red-500/10"
                        >
                          Revoke
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

      {/* Tab 3: Webhooks */}
      {tab === 'webhooks' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-1 h-fit bg-transparent border-border shadow-2xs">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-bold flex items-center gap-2 text-foreground">
                <Webhook className="h-4 w-4 text-primary" /> Add Webhook Endpoint
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleCreateWebhook} className="space-y-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-foreground">Endpoint Name</label>
                  <Input required value={whName} onChange={(e) => setWhName(e.target.value)} placeholder="Production Webhook" className="h-8 text-xs bg-card border-border" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-foreground">Target URL</label>
                  <Input required type="url" value={whUrl} onChange={(e) => setWhUrl(e.target.value)} placeholder="https://api.example.com/webhooks" className="h-8 text-xs font-mono bg-card border-border" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-foreground">Subscribed Events</label>
                  <Input value={whEvents} onChange={(e) => setWhEvents(e.target.value)} placeholder="post.published,member.created" className="h-8 text-xs font-mono bg-card border-border" />
                </div>
                <Button type="submit" size="sm" className="w-full h-8 text-xs font-semibold bg-primary hover:bg-primary/90 text-primary-foreground mt-2">
                  Register Webhook
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card className="lg:col-span-2 bg-transparent border-border shadow-2xs p-0 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="border-border">
                  <TableHead className="pl-6 text-xs">Name</TableHead>
                  <TableHead className="text-xs">URL</TableHead>
                  <TableHead className="text-right pr-6 text-xs">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {webhooks.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="h-32 text-center text-xs text-muted-foreground">
                      No webhooks registered.
                    </TableCell>
                  </TableRow>
                ) : (
                  webhooks.map((w) => (
                    <TableRow key={w.id} className="hover:bg-muted/40 border-border">
                      <TableCell className="pl-6 font-semibold text-xs text-foreground">{w.name}</TableCell>
                      <TableCell className="text-xs font-mono text-muted-foreground truncate max-w-xs">{w.url}</TableCell>
                      <TableCell className="text-right pr-6">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeleteWebhook(w.id)}
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

      {/* Tab 4: Plugins */}
      {tab === 'plugins' && (
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
      )}
    </div>
  );
}
