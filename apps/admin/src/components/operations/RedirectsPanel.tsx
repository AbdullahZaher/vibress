import React, { useState } from "react";
import {
  AdminRedirect,
  createRedirectApi,
  deleteRedirectApi,
} from "../../lib/api";
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
import { ArrowRightLeft } from "lucide-react";

interface RedirectsPanelProps {
  redirects: AdminRedirect[];
  onError: (message: string) => void;
  onMessage: (message: string) => void;
  onChanged: () => Promise<void>;
}

export function RedirectsPanel({
  redirects,
  onError,
  onMessage,
  onChanged,
}: RedirectsPanelProps) {
  const [rdSource, setRdSource] = useState("");
  const [rdDest, setRdDest] = useState("");
  const [rdCode, setRdCode] = useState("301");

  const handleCreateRedirect = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createRedirectApi({
        source: rdSource,
        destination: rdDest,
        statusCode: parseInt(rdCode, 10) || 301,
      });
      setRdSource("");
      setRdDest("");
      onMessage("Redirect rule created");
      await onChanged();
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : "Failed");
    }
  };

  const handleDeleteRedirect = async (id: string) => {
    try {
      await deleteRedirectApi(id);
      onMessage("Redirect rule deleted");
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
            <ArrowRightLeft className="h-4 w-4 text-primary" /> New Redirect
            Rule
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreateRedirect} className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-foreground">
                Source Path
              </label>
              <Input
                required
                value={rdSource}
                onChange={(e) => setRdSource(e.target.value)}
                placeholder="/old-post"
                className="h-8 text-xs font-mono bg-card border-border"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-foreground">
                Destination Path / URL
              </label>
              <Input
                required
                value={rdDest}
                onChange={(e) => setRdDest(e.target.value)}
                placeholder="/new-post"
                className="h-8 text-xs font-mono bg-card border-border"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-foreground">
                HTTP Status Code
              </label>
              <select
                value={rdCode}
                onChange={(e) => setRdCode(e.target.value)}
                className="w-full h-8 text-xs bg-card border border-border rounded-md px-2 text-foreground"
              >
                <option value="301">301 (Permanent)</option>
                <option value="302">302 (Temporary)</option>
              </select>
            </div>
            <Button
              type="submit"
              size="sm"
              className="w-full h-8 text-xs font-semibold bg-primary hover:bg-primary/90 text-primary-foreground mt-2"
            >
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
                <TableCell
                  colSpan={4}
                  className="h-32 text-center text-xs text-muted-foreground"
                >
                  No redirect rules defined.
                </TableCell>
              </TableRow>
            ) : (
              redirects.map((r) => (
                <TableRow
                  key={r.id}
                  className="hover:bg-muted/40 border-border"
                >
                  <TableCell className="pl-6 font-mono text-xs text-foreground">
                    {r.source}
                  </TableCell>
                  <TableCell className="text-xs font-mono text-muted-foreground">
                    {r.destination}
                  </TableCell>
                  <TableCell className="text-xs font-mono font-semibold text-emerald-500">
                    {r.statusCode}
                  </TableCell>
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
  );
}
