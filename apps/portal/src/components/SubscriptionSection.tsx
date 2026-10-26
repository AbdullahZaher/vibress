import { useCallback, useEffect, useState } from "react";
import { memberApi, MemberSubscription } from "../lib/member-api";
import { navigate } from "../router";

interface Props {
  authLost: () => void;
}

export function SubscriptionSection({ authLost }: Props) {
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
          err instanceof Error ? err.message : "Failed to load subscription",
        );
    } finally {
      setLoading(false);
    }
  }, [authLost]);

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
      else setError(err instanceof Error ? err.message : "Action failed");
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
          err instanceof Error ? err.message : "Could not open billing portal",
        );
      setAction(null);
    }
  };

  if (loading) {
    return (
      <section className="ap-section">
        <div className="ap-skeleton" />
      </section>
    );
  }

  const statusTone = (status: string) =>
    ["active", "trialing", "free"].includes(status)
      ? "ok"
      : ["past_due", "unpaid"].includes(status)
        ? "bad"
        : "warn";

  return (
    <section className="ap-section" aria-labelledby="member-h">
      <div className="ap-section-head">
        <h2 className="ap-section-title" id="member-h">
          Membership
        </h2>
      </div>
      {error && (
        <p role="alert" className="ap-alert bad">
          {error}
        </p>
      )}

      {subscriptions.length === 0 ? (
        <div className="ap-group">
          <div className="ap-row">
            <span className="ap-row-meta" style={{ fontSize: 15 }}>
              You don't have a membership yet.
            </span>
            <button
              onClick={() => navigate("/plans")}
              className="ap-btn ap-btn-sm"
            >
              View plans
            </button>
          </div>
        </div>
      ) : (
        subscriptions.map((sub) => (
          <div key={sub.id} className="ap-group" style={{ marginBottom: 12 }}>
            <div className="ap-row ap-row-stack">
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 12,
                }}
              >
                <span className="ap-row-title">{sub.planName}</span>
                <span className={`ap-pill ${statusTone(sub.status)}`}>
                  {sub.status.replace("_", " ")}
                </span>
              </div>
              {sub.status !== "free" && (
                <div className="ap-row-meta">
                  {formatAmount(sub.currency, sub.amountMinor)}
                  {sub.billingInterval === "year" ? "/year" : "/month"}
                </div>
              )}
              {sub.trialEnd && sub.status === "trialing" && (
                <div className="ap-row-meta warn">
                  Trial ends {new Date(sub.trialEnd).toLocaleDateString()}
                </div>
              )}
              {sub.currentPeriodEnd &&
                ["active", "past_due", "unpaid"].includes(sub.status) && (
                  <div
                    className={`ap-row-meta${
                      sub.status === "past_due" || sub.status === "unpaid"
                        ? " bad"
                        : ""
                    }`}
                  >
                    {sub.status === "past_due" || sub.status === "unpaid"
                      ? "Payment failed — update your payment method to keep access."
                      : `Renews ${new Date(sub.currentPeriodEnd).toLocaleDateString()}`}
                  </div>
                )}
              {sub.cancelAtPeriodEnd && sub.status !== "cancelled" && (
                <div className="ap-row-meta warn">
                  Cancellation scheduled for period end
                  {sub.currentPeriodEnd
                    ? ` (${new Date(sub.currentPeriodEnd).toLocaleDateString()})`
                    : ""}
                </div>
              )}
            </div>
            <div className="ap-row">
              <div className="ap-actions">
                {sub.cancelAtPeriodEnd && sub.status !== "cancelled" && (
                  <button
                    onClick={() =>
                      runAction("resume", () =>
                        memberApi.resumeSubscription(sub.id),
                      )
                    }
                    disabled={action !== null}
                    className="ap-btn ap-btn-sm"
                  >
                    {action === "resume" ? "Resuming…" : "Resume membership"}
                  </button>
                )}
                {["active", "past_due", "unpaid"].includes(sub.status) && (
                  <button
                    onClick={openBillingPortal}
                    disabled={action !== null}
                    className="ap-btn ap-btn-sm ap-btn-secondary"
                  >
                    {action === "portal" ? "Opening…" : "Billing portal"}
                  </button>
                )}
                {!sub.cancelAtPeriodEnd &&
                  ["active", "trialing", "past_due"].includes(sub.status) && (
                    <button
                      onClick={() =>
                        runAction("cancel", () =>
                          memberApi.cancelSubscription(sub.id),
                        )
                      }
                      disabled={action !== null}
                      className="ap-btn ap-btn-sm ap-btn-danger"
                    >
                      {action === "cancel"
                        ? "Cancelling…"
                        : "Cancel at period end"}
                    </button>
                  )}
              </div>
            </div>
          </div>
        ))
      )}
    </section>
  );
}

function formatAmount(currency: string, amountMinor: number): string {
  const amount = amountMinor / 100;
  const symbol =
    currency === "USD" ? "$" : currency === "SAR" ? "SAR " : `${currency} `;
  return `${symbol}${amount.toFixed(2)}`;
}

