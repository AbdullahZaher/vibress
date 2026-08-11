import { AdminCommentReport, resolveCommentReportApi } from '../../lib/api';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { Badge } from '../ui/badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../ui/table';

interface ReportsPanelProps {
  reports: AdminCommentReport[];
  onError: (message: string) => void;
  onChanged: () => Promise<void>;
}

export function ReportsPanel({ reports, onError, onChanged }: ReportsPanelProps) {
  const handleResolveReport = async (id: string) => {
    try {
      await resolveCommentReportApi(id, 'resolved');
      await onChanged();
    } catch (e: unknown) {
      onError(e instanceof Error ? e.message : 'Failed');
    }
  };

  return (
    <Card className="bg-transparent border-border shadow-2xs p-0 overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="border-border">
            <TableHead className="pl-6 text-xs">Reason</TableHead>
            <TableHead className="text-xs">Comment ID</TableHead>
            <TableHead className="text-xs">Status</TableHead>
            <TableHead className="text-right pr-6 text-xs">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {reports.length === 0 ? (
            <TableRow>
              <TableCell colSpan={4} className="h-32 text-center text-xs text-muted-foreground">
                No pending comment reports.
              </TableCell>
            </TableRow>
          ) : (
            reports.map((r) => (
              <TableRow key={r.id} className="hover:bg-muted/40 border-border">
                <TableCell className="pl-6 font-semibold text-xs text-foreground">{r.reason}</TableCell>
                <TableCell className="text-xs font-mono text-muted-foreground">{r.commentId}</TableCell>
                <TableCell>
                  <Badge variant="outline" className="text-[10px] font-mono px-2 py-0.5 bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20">
                    {r.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-right pr-6">
                  {r.status === 'open' && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleResolveReport(r.id)}
                      className="h-7 text-xs border-border bg-card hover:bg-accent text-foreground"
                    >
                      Mark Resolved
                    </Button>
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