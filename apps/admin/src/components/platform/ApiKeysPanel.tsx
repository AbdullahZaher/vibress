import React, { useState } from 'react';
import { AdminApiKey, createApiKeyApi, revokeApiKeyApi } from '../../lib/api';
import { Button } from '../ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Input } from '../ui/input';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../ui/table';
import { Key } from 'lucide-react';

interface ApiKeysPanelProps {
  apiKeys: AdminApiKey[];
  onError: (message: string) => void;
  onMessage: (message: string) => void;
  onNewSecret: (secret: string | null) => void;
  onChanged: () => Promise<void>;
}

export function ApiKeysPanel({ apiKeys, onError, onMessage, onNewSecret, onChanged }: ApiKeysPanelProps) {
  const [keyName, setKeyName] = useState('');

  const handleCreateApiKey = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await createApiKeyApi({ name: keyName, scopes: ['*'] });
      setKeyName('');
      onNewSecret(res.key.secret || null);
      onMessage('API Key generated successfully. Copy the secret now!');
      await onChanged();
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : 'Failed');
    }
  };

  const handleRevokeApiKey = async (id: string) => {
    try {
      await revokeApiKeyApi(id);
      onMessage('API key revoked');
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
  );
}