import React, { useState } from "react";
import { AdminIntegration, createIntegrationApi } from "../../lib/api";
import { Button } from "../ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "../ui/card";
import { Input } from "../ui/input";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "../ui/table";
import { Server } from "lucide-react";

interface IntegrationsPanelProps {
  integrations: AdminIntegration[];
  onError: (message: string) => void;
  onMessage: (message: string) => void;
  onChanged: () => Promise<void>;
}

export function IntegrationsPanel({
  integrations,
  onError,
  onMessage,
  onChanged,
}: IntegrationsPanelProps) {
  const [intKey, setIntKey] = useState("");
  const [intName, setIntName] = useState("");

  const handleCreateIntegration = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createIntegrationApi({
        key: intKey,
        type: "custom",
        name: intName,
      });
      setIntKey("");
      setIntName("");
      onMessage("Integration created");
      await onChanged();
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : "Failed");
    }
  };

  return (
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
              <label className="text-xs font-medium text-foreground">
                Slug / Key
              </label>
              <Input
                required
                value={intKey}
                onChange={(e) => setIntKey(e.target.value)}
                placeholder="zapier-connector"
                className="h-8 text-xs font-mono bg-card border-border"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-foreground">
                Integration Name
              </label>
              <Input
                required
                value={intName}
                onChange={(e) => setIntName(e.target.value)}
                placeholder="Zapier Automation"
                className="h-8 text-xs bg-card border-border"
              />
            </div>
            <Button
              type="submit"
              size="sm"
              className="w-full h-8 text-xs font-semibold bg-primary hover:bg-primary/90 text-primary-foreground mt-2"
            >
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
                <TableCell
                  colSpan={3}
                  className="h-32 text-center text-xs text-muted-foreground"
                >
                  No custom integrations added.
                </TableCell>
              </TableRow>
            ) : (
              integrations.map((i) => (
                <TableRow
                  key={i.id}
                  className="hover:bg-muted/40 border-border"
                >
                  <TableCell className="pl-6 font-semibold text-xs text-foreground">
                    {i.name}
                  </TableCell>
                  <TableCell className="text-xs font-mono text-muted-foreground">
                    {i.key}
                  </TableCell>
                  <TableCell className="text-xs font-mono capitalize">
                    {i.type}
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
