import React, { useState } from "react";
import {
  AdminNewsletter,
  createNewsletterApi,
  archiveNewsletterApi,
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
import { Mail } from "lucide-react";

interface NewslettersListPanelProps {
  newsletters: AdminNewsletter[];
  onError: (message: string) => void;
  onMessage: (message: string) => void;
  onChanged: () => Promise<void>;
}

export function NewslettersListPanel({
  newsletters,
  onError,
  onMessage,
  onChanged,
}: NewslettersListPanelProps) {
  const [nlKey, setNlKey] = useState("");
  const [nlName, setNlName] = useState("");

  const handleCreateNewsletter = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createNewsletterApi({
        key: nlKey,
        name: nlName,
        senderName: "Vibress",
        senderEmail: "noreply@vibress.local",
      });
      setNlKey("");
      setNlName("");
      onMessage("Newsletter created");
      await onChanged();
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : "Failed");
    }
  };

  const handleArchiveNewsletter = async (id: string) => {
    try {
      await archiveNewsletterApi(id);
      onMessage("Newsletter archived");
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
            <Mail className="h-4 w-4 text-primary" /> New Newsletter
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreateNewsletter} className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-foreground">
                Slug / Key
              </label>
              <Input
                required
                value={nlKey}
                onChange={(e) => setNlKey(e.target.value)}
                placeholder="weekly-digest"
                className="h-8 text-xs font-mono bg-card border-border"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-foreground">
                Newsletter Name
              </label>
              <Input
                required
                value={nlName}
                onChange={(e) => setNlName(e.target.value)}
                placeholder="Weekly Engineering Digest"
                className="h-8 text-xs bg-card border-border"
              />
            </div>
            <Button
              type="submit"
              size="sm"
              className="w-full h-8 text-xs font-semibold bg-primary hover:bg-primary/90 text-primary-foreground mt-2"
            >
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
              <TableHead className="text-[10px] text-muted-foreground font-mono">
                Sender
              </TableHead>
              <TableHead className="text-right pr-6 text-xs">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {newsletters.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={4}
                  className="h-32 text-center text-xs text-muted-foreground"
                >
                  No newsletters configured.
                </TableCell>
              </TableRow>
            ) : (
              newsletters.map((n) => (
                <TableRow
                  key={n.id}
                  className="hover:bg-muted/40 border-border"
                >
                  <TableCell className="pl-6 font-semibold text-xs text-foreground">
                    {n.name}
                  </TableCell>
                  <TableCell className="text-xs font-mono text-muted-foreground">
                    {n.key}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground font-mono">
                    {n.senderEmail}
                  </TableCell>
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
  );
}
