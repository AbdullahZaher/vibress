import { AdminImportExportJob, createExportApi } from '../../lib/api';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { Badge } from '../ui/badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../ui/table';
import { Download } from 'lucide-react';

interface TransferPanelProps {
  jobs: AdminImportExportJob[];
  onError: (message: string) => void;
  onMessage: (message: string) => void;
  onChanged: () => Promise<void>;
}

export function TransferPanel({ jobs, onError, onMessage, onChanged }: TransferPanelProps) {
  const handleTriggerExport = async () => {
    try {
      await createExportApi();
      onMessage('Publication export task queued');
      await onChanged();
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : 'Failed');
    }
  };

  return (
    <div className="space-y-6">
      <Card className="p-6 bg-transparent border-border shadow-2xs flex items-center justify-between">
        <div>
          <h3 className="font-bold text-sm text-foreground">Full Publication Data Backup</h3>
          <p className="text-xs text-muted-foreground pt-0.5">Export all posts, pages, tags, members, and configuration settings in JSON format.</p>
        </div>
        <Button
          onClick={handleTriggerExport}
          className="h-8 text-xs font-semibold bg-primary hover:bg-primary/90 text-primary-foreground gap-1.5"
        >
          <Download className="h-3.5 w-3.5" /> Export All Data
        </Button>
      </Card>

      <Card className="bg-transparent border-border shadow-2xs p-0 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-border">
              <TableHead className="pl-6 text-xs">Job Type</TableHead>
              <TableHead className="text-xs">Status</TableHead>
              <TableHead className="text-right pr-6 text-xs">Created At</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {jobs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="h-32 text-center text-xs text-muted-foreground">
                  No background data jobs executed yet.
                </TableCell>
              </TableRow>
            ) : (
              jobs.map((j) => (
                <TableRow key={j.id} className="hover:bg-muted/40 border-border text-xs">
                  <TableCell className="pl-6 font-semibold text-foreground capitalize">{j.type}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-[10px] font-mono px-2 py-0.5 bg-muted text-muted-foreground border-border">
                      {j.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right pr-6 font-mono text-muted-foreground">{new Date(j.createdAt).toLocaleString()}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}