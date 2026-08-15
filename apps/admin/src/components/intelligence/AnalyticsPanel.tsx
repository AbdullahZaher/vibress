import { AdminMetric } from "../../lib/api";
import { Card } from "../ui/card";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "../ui/table";

interface AnalyticsPanelProps {
  metrics: AdminMetric[];
  metricsRange: { from: string; to: string };
}

export function AnalyticsPanel({ metrics, metricsRange }: AnalyticsPanelProps) {
  return (
    <Card className="bg-transparent border-border shadow-2xs p-0 overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="border-border">
            <TableHead className="pl-6 text-xs">Metric Date</TableHead>
            <TableHead className="text-xs">Metric Name</TableHead>
            <TableHead className="text-right pr-6 text-xs">
              Total Count
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {metrics.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={3}
                className="h-32 text-center text-xs text-muted-foreground"
              >
                No analytics metrics aggregated for timeframe (
                {metricsRange.from} - {metricsRange.to}).
              </TableCell>
            </TableRow>
          ) : (
            metrics.map((m, idx) => (
              <TableRow
                key={idx}
                className="hover:bg-muted/40 border-border font-mono text-xs"
              >
                <TableCell className="pl-6 font-medium text-foreground">
                  {m.date}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {m.name}
                </TableCell>
                <TableCell className="text-right pr-6 text-foreground font-semibold">
                  {m.count}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </Card>
  );
}
