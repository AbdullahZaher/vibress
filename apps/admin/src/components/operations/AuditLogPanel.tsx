import { AdminAuditEvent } from "../../lib/api";
import { Card } from "../ui/card";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "../ui/table";

interface AuditLogPanelProps {
  audit: AdminAuditEvent[];
}

export function AuditLogPanel({ audit }: AuditLogPanelProps) {
  return (
    <Card className="bg-transparent border-border shadow-2xs p-0 overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="border-border">
            <TableHead className="pl-6 text-xs">Timestamp</TableHead>
            <TableHead className="text-xs">Actor</TableHead>
            <TableHead className="text-xs">Action</TableHead>
            <TableHead className="text-right pr-6 text-xs">Resource</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {audit.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={4}
                className="h-32 text-center text-xs text-muted-foreground"
              >
                No audit log events recorded.
              </TableCell>
            </TableRow>
          ) : (
            audit.map((ev) => (
              <TableRow
                key={ev.id}
                className="hover:bg-muted/40 border-border text-xs"
              >
                <TableCell className="pl-6 font-mono text-muted-foreground">
                  {new Date(ev.createdAt).toLocaleString()}
                </TableCell>
                <TableCell className="font-semibold text-foreground">
                  {ev.actorUserId || "System"}
                </TableCell>
                <TableCell className="font-mono text-emerald-500 font-semibold">
                  {ev.action}
                </TableCell>
                <TableCell className="text-right pr-6 font-mono text-muted-foreground">
                  {ev.targetType}:{ev.targetId}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </Card>
  );
}
