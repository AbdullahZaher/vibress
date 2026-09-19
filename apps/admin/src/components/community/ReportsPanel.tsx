import { AdminCommentReport, resolveCommentReportApi } from "../../lib/api";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Badge } from "../ui/badge";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "../ui/table";
import { Check, X } from "lucide-react";

interface ReportsPanelProps {
  reports: AdminCommentReport[];
  onError: (message: string) => void;
  onChanged: () => Promise<void>;
}

export function ReportsPanel({
  reports,
  onError,
  onChanged,
}: ReportsPanelProps) {
  const handleResolve = async (id: string) => {
    try {
      await resolveCommentReportApi(id, "resolved");
      await onChanged();
    } catch (e: unknown) {
      onError(e instanceof Error ? e.message : "Failed to resolve report");
    }
  };

  const handleDismiss = async (id: string) => {
    try {
      await resolveCommentReportApi(id, "dismissed");
      await onChanged();
    } catch (e: unknown) {
      onError(e instanceof Error ? e.message : "Failed to dismiss report");
    }
  };

  return (
    <Card className="bg-transparent border-border shadow-2xs p-0 overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="border-border">
            <TableHead className="ps-6 text-xs">Reason</TableHead>
            <TableHead className="text-xs">Comment ID</TableHead>
            <TableHead className="text-xs">Reporter</TableHead>
            <TableHead className="text-xs">Status</TableHead>
            <TableHead className="text-end pe-6 text-xs">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {reports.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={5}
                className="h-32 text-center text-xs text-muted-foreground"
              >
                No comment reports found.
              </TableCell>
            </TableRow>
          ) : (
            reports.map((r) => (
              <TableRow key={r.id} className="hover:bg-muted/40 border-border">
                <TableCell className="ps-6 font-semibold text-xs text-foreground">
                  <div className="flex flex-col">
                    <span className="capitalize">{r.reason.replace("_", " ")}</span>
                    <span className="text-[10px] text-muted-foreground font-mono">
                      {new Date(r.createdAt).toLocaleString()}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="text-xs font-mono text-muted-foreground">
                  {r.commentId}
                </TableCell>
                <TableCell className="text-xs font-mono text-muted-foreground">
                  {r.reporterId}
                </TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className={`text-[10px] font-mono px-2 py-0.5 ${
                      r.status === "open"
                        ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20"
                        : r.status === "resolved"
                        ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                        : "bg-muted text-muted-foreground border-border"
                    }`}
                  >
                    {r.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-end pe-6">
                  {r.status === "open" ? (
                    <div className="flex items-center justify-end gap-1.5">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleResolve(r.id)}
                        className="h-7 text-xs border-emerald-500/30 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10 gap-1"
                      >
                        <Check className="h-3 w-3" /> Resolve
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDismiss(r.id)}
                        className="h-7 text-xs text-muted-foreground hover:text-foreground gap-1"
                      >
                        <X className="h-3 w-3" /> Dismiss
                      </Button>
                    </div>
                  ) : (
                    <span className="text-[11px] text-muted-foreground font-mono">
                      {r.resolvedAt ? new Date(r.resolvedAt).toLocaleDateString() : "-"}
                    </span>
                  )}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </Card>
  );
}
