import { useCallback, useEffect, useState } from "react";
import { memberApi, MemberSubscription } from "../lib/member-api";
import { navigate } from "../router";
import { useTranslation } from "../lib/i18n";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  Button,
  Badge,
  Alert,
  Spinner,
} from "@vibress/ui";
import { CreditCard, Calendar, AlertTriangle, ArrowUpRight } from "lucide-react";

interface Props {
  authLost: () => void;
}

export function SubscriptionSection({ authLost }: Props) {
  const { t, formatCurrency, formatDate } = useTranslation();
  const [subscriptions, setSubscriptions] = useState<MemberSubscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await memberApi.listSubscriptions();
      setSubscriptions(res.subscriptions);
      setError(null);
    } catch (err: unknown) {
      if (
        err instanceof Error &&
        "status" in err &&
        (err as { status?: number }).status === 401
      )
        authLost();
      else
        setError(
          err instanceof Error ? err.message : t("common.error"),
        );
    } finally {
      setLoading(false);
    }
  }, [authLost, t]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 8000);
    return () => clearInterval(timer);
  }, [refresh]);

  const runAction = async (actionName: string, fn: () => Promise<unknown>) => {
    setAction(actionName);
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (err: unknown) {
      if (
        err instanceof Error &&
        "status" in err &&
        (err as { status?: number }).status === 401
      )
        authLost();
      else setError(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setAction(null);
    }
  };

  const openBillingPortal = async () => {
    setAction("portal");
    setError(null);
    try {
      const res = await memberApi.createBillingPortal();
      window.location.href = res.url;
    } catch (err: unknown) {
      if (
        err instanceof Error &&
        "status" in err &&
        (err as { status?: number }).status === 401
      )
        authLost();
      else
        setError(
          err instanceof Error ? err.message : t("common.error"),
        );
      setAction(null);
    }
  };

  if (loading) {
    return (
      <div className="py-6 flex items-center justify-center text-muted-foreground gap-2">
        <Spinner size="sm" />
        <span className="text-xs">{t("common.loading")}</span>
      </div>
    );
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "active":
        return <Badge variant="published">Active</Badge>;
      case "trialing":
        return <Badge variant="scheduled">Trial</Badge>;
      case "past_due":
      case "unpaid":
        return <Badge variant="destructive">Payment Due</Badge>;
      case "cancelled":
        return <Badge variant="draft">Cancelled</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-3 pt-6 border-t border-border/80">
      <div className="flex items-center justify-between">
        <div className="space-y-0.5 text-start">
          <h3 className="text-sm sm:text-base font-bold tracking-tight text-foreground flex items-center gap-2">
            <CreditCard className="size-4 text-primary" />
            <span>{t("portal.subscriptions_title")}</span>
          </h3>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {t("portal.subscriptions_desc")}
          </p>
        </div>
      </div>

      {error && <Alert variant="destructive">{error}</Alert>}

      {subscriptions.length === 0 ? (
        <Card className="border border-border/80 bg-muted/20 p-5 text-start">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-semibold text-foreground">
                  {t("portal.free_plan")}
                </h4>
                <Badge variant="secondary">Current</Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                You are currently on the free member tier.
              </p>
            </div>
            <Button
              id="btn-view-plans"
              size="sm"
              onClick={() => navigate("/plans")}
              className="gap-1.5 shrink-0 shadow-2xs font-semibold"
            >
              <span>{t("portal.upgrade_plan")}</span>
              <ArrowUpRight className="size-3.5" />
            </Button>
          </div>
        </Card>
      ) : (
        <div className="space-y-3">
          {subscriptions.map((sub) => (
            <Card
              key={sub.id}
              className="border border-border/80 shadow-2xs overflow-hidden text-start"
            >
              <CardHeader className="p-4 sm:p-5 pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <CardTitle className="text-base font-bold text-foreground">
                        {sub.planName}
                      </CardTitle>
                      {getStatusBadge(sub.status)}
                    </div>
                    <CardDescription className="text-xs text-muted-foreground font-mono">
                      {sub.status !== "free" && (
                        <>
                          {formatCurrency(sub.amountMinor / 100, sub.currency)}
                          <span>
                            {sub.billingInterval === "year" ? "/year" : "/month"}
                          </span>
                        </>
                      )}
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="p-4 sm:p-5 pt-0 space-y-3">
                {sub.trialEnd && sub.status === "trialing" && (
                  <div className="p-2.5 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-700 dark:text-blue-400 text-xs flex items-center gap-2">
                    <Calendar className="size-3.5 shrink-0" />
                    <span>Trial ends {formatDate(new Date(sub.trialEnd))}</span>
                  </div>
                )}

                {sub.currentPeriodEnd &&
                  ["active", "past_due", "unpaid"].includes(sub.status) && (
                    <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <Calendar className="size-3.5 text-muted-foreground" />
                      <span>
                        {sub.status === "past_due" || sub.status === "unpaid"
                          ? "Payment failed — update your payment method to keep access."
                          : `Renews ${formatDate(new Date(sub.currentPeriodEnd))}`}
                      </span>
                    </div>
                  )}

                {sub.cancelAtPeriodEnd && sub.status !== "cancelled" && (
                  <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-400 text-xs flex items-center gap-2">
                    <AlertTriangle className="size-3.5 shrink-0" />
                    <span>
                      Cancellation scheduled for period end
                      {sub.currentPeriodEnd
                        ? ` (${formatDate(new Date(sub.currentPeriodEnd))})`
                        : ""}
                    </span>
                  </div>
                )}

                {/* Actions */}
                <div className="flex items-center gap-2.5 pt-2 flex-wrap border-t border-border/40">
                  {sub.cancelAtPeriodEnd && sub.status !== "cancelled" && (
                    <Button
                      size="sm"
                      onClick={() =>
                        runAction("resume", () =>
                          memberApi.resumeSubscription(sub.id),
                        )
                      }
                      loading={action === "resume"}
                      className="font-semibold shadow-2xs"
                    >
                      {action === "resume" ? t("portal.saving") : "Resume membership"}
                    </Button>
                  )}

                  {!sub.cancelAtPeriodEnd &&
                    ["active", "trialing", "past_due"].includes(sub.status) && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          runAction("cancel", () =>
                            memberApi.cancelSubscription(sub.id),
                          )
                        }
                        loading={action === "cancel"}
                        className="text-destructive hover:bg-destructive/10 hover:text-destructive border-border/80 text-xs"
                      >
                        {action === "cancel"
                          ? t("portal.saving")
                          : t("portal.cancel_sub")}
                      </Button>
                    )}

                  {["active", "past_due", "unpaid"].includes(sub.status) && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={openBillingPortal}
                      loading={action === "portal"}
                      className="text-xs border-border/80 shadow-2xs gap-1.5"
                    >
                      <span>
                        {action === "portal" ? t("portal.saving") : t("portal.manage_sub")}
                      </span>
                      <ArrowUpRight className="size-3.5" />
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
