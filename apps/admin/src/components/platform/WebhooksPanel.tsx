import React, { useState } from 'react';
import { AdminWebhookEndpoint, createWebhookEndpointApi, deleteWebhookEndpointApi } from '../../lib/api';
import { Button } from '../ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Input } from '../ui/input';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../ui/table';
import { Webhook } from 'lucide-react';

interface WebhooksPanelProps {
  webhooks: AdminWebhookEndpoint[];
  onError: (message: string) => void;
  onMessage: (message: string) => void;
  onChanged: () => Promise<void>;
}

export function WebhooksPanel({ webhooks, onError, onMessage, onChanged }: WebhooksPanelProps) {
  const [whName, setWhName] = useState('');
  const [whUrl, setWhUrl] = useState('');
  const [whEvents, setWhEvents] = useState('post.published,member.created');
  const [whSecret, setWhSecret] = useState('');

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
      onMessage('Webhook endpoint added');
      await onChanged();
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : 'Failed');
    }
  };

  const handleDeleteWebhook = async (id: string) => {
    try {
      await deleteWebhookEndpointApi(id);
      onMessage('Webhook endpoint deleted');
      await onChanged();
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : 'Failed');
    }
  };

  return (
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
  );
}