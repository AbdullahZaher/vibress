import React, { useState } from "react";
import {
  AdminNewsletter,
  AdminNewsletterSend,
  createNewsletterSendApi,
  sendNewsletterNowApi,
  cancelNewsletterSendApi,
} from "../../lib/api";
import { Button } from "../ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "../ui/card";
import { Badge } from "../ui/badge";
import { Input } from "../ui/input";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "../ui/table";
import { Send, Play, Ban } from "lucide-react";

interface BroadcastsPanelProps {
  newsletters: AdminNewsletter[];
  sends: AdminNewsletterSend[];
  sendNlId: string;
  onSendNlIdChange: (id: string) => void;
  onError: (message: string) => void;
  onMessage: (message: string) => void;
  onChanged: () => Promise<void>;
}

export function BroadcastsPanel({
  newsletters,
  sends,
  sendNlId,
  onSendNlIdChange,
  onError,
  onMessage,
  onChanged,
}: BroadcastsPanelProps) {
  const [sendSubject, setSendSubject] = useState("");

  const handleCreateSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sendNlId) return;
    try {
      await createNewsletterSendApi({
        newsletterId: sendNlId,
        subject: sendSubject,
        content: { type: "doc", content: [] },
        audience: { filter: "all" },
      });
      setSendSubject("");
      onMessage("Broadcast created");
      await onChanged();
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : "Failed");
    }
  };

  const handleSendNow = async (id: string) => {
    try {
      await sendNewsletterNowApi(id);
      onMessage("Newsletter dispatch initiated");
      await onChanged();
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : "Failed");
    }
  };

  const handleCancelSend = async (id: string) => {
    try {
      await cancelNewsletterSendApi(id);
      onMessage("Newsletter dispatch canceled");
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
            <Send className="h-4 w-4 text-primary" /> New Broadcast
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreateSend} className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-foreground">
                Select Newsletter
              </label>
              <select
                value={sendNlId}
                onChange={(e) => onSendNlIdChange(e.target.value)}
                className="w-full h-8 text-xs bg-card border border-border rounded-md px-2 text-foreground font-medium"
              >
                {newsletters.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-foreground">
                Subject Line
              </label>
              <Input
                required
                value={sendSubject}
                onChange={(e) => setSendSubject(e.target.value)}
                placeholder="Issue #10: Monorepos Unleashed"
                className="h-8 text-xs bg-card border-border"
              />
            </div>
            <Button
              type="submit"
              size="sm"
              className="w-full h-8 text-xs font-semibold bg-primary hover:bg-primary/90 text-primary-foreground mt-2"
            >
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
                <TableCell
                  colSpan={3}
                  className="h-32 text-center text-xs text-muted-foreground"
                >
                  No broadcast sends recorded.
                </TableCell>
              </TableRow>
            ) : (
              sends.map((s) => (
                <TableRow
                  key={s.id}
                  className="hover:bg-muted/40 border-border"
                >
                  <TableCell className="pl-6 font-semibold text-xs text-foreground">
                    {s.subject}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className="text-[10px] font-mono px-2 py-0.5 bg-muted text-muted-foreground border-border"
                    >
                      {s.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right pr-6">
                    <div className="flex items-center justify-end gap-1.5">
                      {s.status === "draft" && (
                        <Button
                          size="sm"
                          onClick={() => handleSendNow(s.id)}
                          className="h-7 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white gap-1"
                        >
                          <Play className="h-3 w-3" /> Dispatch Now
                        </Button>
                      )}
                      {s.status === "scheduled" && (
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
  );
}
