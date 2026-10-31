import { useState, useEffect, useCallback } from "react";
import { useAdminLocale } from "../lib/admin-locale";
import {
  AdminSubscription,
  listSubscriptionsApi,
  cancelSubscriptionApi,
  getSubscriptionApi,
} from "../lib/api";

import { Button } from "./ui/button";
import { AdminPageHeader } from "./common/AdminPageHeader";
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
  const { tr } = useAdminLocale();
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
            variant="published"
            className="text-[10px] font-mono px-2 py-0.5 gap-1"
          >
            <CheckCircle2 className="h-3 w-3" /> {subStatus}
          </Badge>
        );
      case "past_due":
      case "unpaid":
        return (
          <Badge
            variant="review"
            className="text-[10px] font-mono px-2 py-0.5 gap-1"
          >
            <AlertCircle className="h-3 w-3" /> {subStatus}
          </Badge>
        );
      default:
        return (
          <Badge
            variant="draft"
            className="text-[10px] font-mono px-2 py-0.5 gap-1"
          >
            <ShieldAlert className="h-3 w-3" /> {subStatus}
          </Badge>
        );
    }
  };

  return (
    <div className="space-y-6 w-full max-w-7xl mx-auto">
      {/* Header */}
      <AdminPageHeader
        title={tr("Subscriptions")}
        description={tr("Manage paid subscriber memberships, billing cycles, and payment statuses.")}
      />

      {error && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 text-xs font-medium">
          {error}
        </div>
      )}

      {/* Filter Tabs Bar */}
      <div className="inline-flex items-center p-1 rounded-lg bg-muted/60 border border-border/60 gap-1 overflow-x-auto max-w-full">
        {[
          { label: tr("All Statuses"), value: "" },
          { label: tr("Active"), value: "active" },
          { label: tr("Past Due"), value: "past_due" },
          { label: tr("Canceled"), value: "canceled" },
        ].map((item) => (
          <button
            key={item.value}
            onClick={() => setStatus(item.value)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all whitespace-nowrap cursor-pointer ${
              status === item.value
                ? "bg-background text-foreground shadow-2xs font-semibold"
                : "text-muted-foreground hover:text-foreground hover:bg-background/40"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {/* Content Table Card */}
      <Card className="border-border/70 shadow-2xs p-0 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-border">
              <TableHead className="ps-6 text-xs">{tr("Member ID")}</TableHead>
              <TableHead className="text-xs">{tr("Plan ID")}</TableHead>
              <TableHead className="text-xs">{tr("Interval")}</TableHead>
              <TableHead className="text-xs">{tr("Status")}</TableHead>
              <TableHead className="text-end pe-6 text-xs">{tr("Actions")}</TableHead>
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
                      {tr("No subscriptions match filter.")}
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
                  <TableCell className="ps-6 font-mono text-xs text-foreground truncate max-w-xs">
                    {sub.memberId}
                  </TableCell>
                  <TableCell className="text-xs font-semibold text-foreground">
                    {sub.planId}
                  </TableCell>
                  <TableCell className="text-xs font-mono text-muted-foreground uppercase">
                    {sub.billingInterval}
                  </TableCell>
                  <TableCell>{getStatusBadge(sub.status)}</TableCell>
                  <TableCell className="text-end pe-6">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => viewDetail(sub.id)}
                      className="h-7 text-xs border-border bg-card hover:bg-accent text-foreground cursor-pointer"
                    >
                      {tr("Details")}
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
        title={tr("Subscription Lifecycle Details")}
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
                {tr("Audit Lifecycle Events")}
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
                  {tr("Cancel Subscription")}
                </Button>
              </div>
            )}
          </div>
        )}
      </Dialog>
    </div>
  );
}
