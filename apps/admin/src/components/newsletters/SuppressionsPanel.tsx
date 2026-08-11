import { AdminSuppression, removeSuppressionApi } from '../../lib/api';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../ui/table';

interface SuppressionsPanelProps {
  suppressions: AdminSuppression[];
  onError: (message: string) => void;
  onMessage: (message: string) => void;
  onChanged: () => Promise<void>;
}

export function SuppressionsPanel({ suppressions, onError, onMessage, onChanged }: SuppressionsPanelProps) {
  const handleRemoveSuppression = async (email: string) => {
    try {
      await removeSuppressionApi(email);
      onMessage('Suppression removed');
      await onChanged();
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : 'Failed');
    }
  };

  return (
    <Card className="bg-transparent border-border shadow-2xs p-0 overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="border-border">
            <TableHead className="pl-6 text-xs">Suppressed Email</TableHead>
            <TableHead className="text-xs">Reason</TableHead>
            <TableHead className="text-right pr-6 text-xs">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {suppressions.length === 0 ? (
            <TableRow>
              <TableCell colSpan={3} className="h-32 text-center text-xs text-muted-foreground">
                No email suppressions recorded.
              </TableCell>
            </TableRow>
          ) : (
            suppressions.map((sup) => (
              <TableRow key={sup.id} className="hover:bg-muted/40 border-border">
                <TableCell className="pl-6 font-mono text-xs text-foreground">{sup.email}</TableCell>
                <TableCell className="text-xs font-mono text-muted-foreground">{sup.reason}</TableCell>
                <TableCell className="text-right pr-6">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRemoveSuppression(sup.email)}
                    className="h-7 px-2 text-xs text-red-600 dark:text-red-400 hover:bg-red-500/10"
                  >
                    Remove
                  </Button>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </Card>
  );
}