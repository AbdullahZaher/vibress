import { useState, useEffect, useCallback } from "react";
import {
  AdminSubscription,
  listSubscriptionsApi,
  cancelSubscriptionApi,
  getSubscriptionApi,
} from "../lib/api";

import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Badge } from "./ui/badge";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "./ui/table";
import { Dialog } from "./ui/dialog";
import {
  CreditCard,
  ShieldAlert,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";

export function SubscriptionsList() {
  const [subscriptions, setSubscriptions] = useState<AdminSubscription[]>([]);
  const [status, setStatus] = useState("");
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<AdminSubscription | null>(null);
  const [events, setEvents] = useState<unknown[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(
    async (resetOffset = false) => {
      const nextOffset = resetOffset ? 0 : offset;
      try {
        const params: { status?: string; limit?: number; offset?: number } = {
          limit: 20,
          offset: nextOffset,
        };
        if (status) params.status = status;
        const res = await listSubscriptionsApi(params);
        setSubscriptions(res.subscriptions);
        setOffset(nextOffset);
        setError(null);
      } catch (err: unknown) {
        setError(
          err instanceof Error ? err.message : "Failed to load subscriptions",
        );
      }
    },
    [status, offset],
  );

  useEffect(() => {
    refresh(true);
  }, [status]);

  const viewDetail = async (id: string) => {
    try {
      const res = await getSubscriptionApi(id);
      setSelected(res.subscription);
      setEvents(res.events);
      setError(null);
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Failed to load subscription",
      );
    }
  };

  const handleCancel = async (id: string) => {
    try {
      await cancelSubscriptionApi(id);
      setSelected(null);
      await refresh();
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Failed to cancel subscription",
      );
    }
  };

  const getStatusBadge = (subStatus: string) => {
    switch (subStatus) {
      case "active":
      case "trialing":
        return (
          <Badge
            variant="outline"
            className="text-[10px] font-mono px-2 py-0.5 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 gap-1"
          >
            <CheckCircle2 className="h-3 w-3" /> {subStatus}
          </Badge>
        );
      case "past_due":
      case "unpaid":
        return (
          <Badge
            variant="outline"
            className="text-[10px] font-mono px-2 py-0.5 bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20 gap-1"
          >
            <AlertCircle className="h-3 w-3" /> {subStatus}
          </Badge>
        );
      default:
        return (
          <Badge
            variant="outline"
            className="text-[10px] font-mono px-2 py-0.5 bg-muted text-muted-foreground border-border gap-1"
          >
            <ShieldAlert className="h-3 w-3" /> {subStatus}
          </Badge>
        );
    }
  };

  return (
    <div className="space-y-8 w-full max-w-7xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold tracking-tight text-foreground">
          Paid Subscriptions
        </h1>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 text-xs font-medium">
          {error}
        </div>
      )}

      {/* Filter Tabs Bar */}
      <div className="flex items-center gap-1.5">
        {[
          { label: "All Statuses", value: "" },
          { label: "Active", value: "active" },
          { label: "Past Due", value: "past_due" },
          { label: "Canceled", value: "canceled" },
        ].map((item) => (
          <button
            key={item.value}
            onClick={() => setStatus(item.value)}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
              status === item.value
                ? "bg-card text-foreground border border-border shadow-2xs font-semibold"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {/* Content Table Card */}
      <Card className="bg-transparent border-border shadow-2xs p-0 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-border">
              <TableHead className="pl-6 text-xs">Member ID</TableHead>
              <TableHead className="text-xs">Plan ID</TableHead>
              <TableHead className="text-xs">Interval</TableHead>
              <TableHead className="text-xs">Status</TableHead>
              <TableHead className="text-right pr-6 text-xs">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {subscriptions.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="h-36 text-center text-muted-foreground"
                >
                  <div className="flex flex-col items-center justify-center space-y-1">
                    <CreditCard className="h-8 w-8 text-muted-foreground/40" />
                    <p className="text-xs font-medium">
                      No subscriptions match filter.
                    </p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              subscriptions.map((sub) => (
                <TableRow
                  key={sub.id}
                  className="hover:bg-muted/40 border-border"
                >
                  <TableCell className="pl-6 font-mono text-xs text-foreground truncate max-w-xs">
                    {sub.memberId}
                  </TableCell>
                  <TableCell className="text-xs font-semibold text-foreground">
                    {sub.planId}
                  </TableCell>
                  <TableCell className="text-xs font-mono text-muted-foreground uppercase">
                    {sub.billingInterval}
                  </TableCell>
                  <TableCell>{getStatusBadge(sub.status)}</TableCell>
                  <TableCell className="text-right pr-6">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => viewDetail(sub.id)}
                      className="h-7 text-xs border-border bg-card hover:bg-accent text-foreground cursor-pointer"
                    >
                      Details
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      {/* Detail Dialog */}
      <Dialog
        isOpen={!!selected}
        onClose={() => setSelected(null)}
        title="Subscription Lifecycle Details"
      >
        {selected && (
          <div className="space-y-4 pt-2 text-xs">
            <div className="p-4 rounded-lg bg-muted/30 border border-border space-y-1 font-mono">
              <p className="text-foreground font-bold">
                Subscription ID: {selected.id}
              </p>
              <p className="text-muted-foreground">
                Member ID: {selected.memberId}
              </p>
              <p className="text-muted-foreground">
                Product ID: {selected.productId}
              </p>
              <p className="text-muted-foreground">
                Current Period Ends:{" "}
                {selected.currentPeriodEnd
                  ? new Date(selected.currentPeriodEnd).toLocaleDateString()
                  : "N/A"}
              </p>
            </div>

            <div className="space-y-2">
              <h4 className="font-bold text-muted-foreground uppercase tracking-wider text-[11px]">
                Audit Lifecycle Events
              </h4>
              <div className="space-y-1 max-h-40 overflow-y-auto font-mono text-[11px]">
                {events.map((ev, idx) => {
                  const event = ev as {
                    eventType?: string;
                    createdAt?: string;
                  };
                  return (
                    <div
                      key={idx}
                      className="p-2 rounded border border-border bg-card"
                    >
                      <span className="text-emerald-500 font-bold">
                        {event.eventType || "event"}
                      </span>{" "}
                      –{" "}
                      {new Date(event.createdAt || Date.now()).toLocaleString()}
                    </div>
                  );
                })}
              </div>
            </div>

            {selected.status === "active" && (
              <div className="pt-2 border-t border-border flex justify-end">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleCancel(selected.id)}
                  className="text-xs text-red-600 dark:text-red-400 hover:bg-red-500/10 gap-1"
                >
                  Cancel Subscription
                </Button>
              </div>
            )}
          </div>
        )}
      </Dialog>
    </div>
  );
}
