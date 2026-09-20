import { useCallback, useEffect, useState } from "react";
import { memberApi, MemberSubscription } from "../lib/member-api";
import { navigate } from "../router";
import { useTranslation } from "../lib/i18n";

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

  if (loading) return <p style={{ color: "#64748b", fontSize: 14 }}>{t("common.loading")}</p>;

  return (
    <div
      style={{ marginTop: 24, paddingTop: 20, borderTop: "1px solid #e2e8f0" }}
    >
      <h2 style={{ fontSize: 17, fontWeight: 700, margin: "0 0 4px", textAlign: "start" }}>
        {t("portal.subscriptions_title")}
      </h2>
      <p style={{ fontSize: 13, color: "#64748b", margin: "0 0 16px", textAlign: "start" }}>
        {t("portal.subscriptions_desc")}
      </p>

      {error && (
        <p
          role="alert"
          style={{ color: "#dc2626", fontSize: 13, margin: "0 0 12px", textAlign: "start" }}
        >
          {error}
        </p>
      )}

      {subscriptions.length === 0 ? (
        <div style={{ textAlign: "start" }}>
          <p style={{ fontSize: 14, color: "#475569", margin: "0 0 12px" }}>
            {t("portal.free_plan")}
          </p>
          <button id="btn-view-plans" onClick={() => navigate("/plans")} style={styles.button}>
            {t("portal.upgrade_plan")}
          </button>
        </div>
      ) : (
        subscriptions.map((sub) => (
          <div
            key={sub.id}
            style={{
              border: "1px solid #e2e8f0",
              borderRadius: 8,
              padding: 16,
              marginBottom: 12,
              textAlign: "start",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div>
                <strong style={{ fontSize: 15, color: "#0f172a" }}>{sub.planName}</strong>
                <div style={{ fontSize: 13, color: "#475569", marginTop: 2 }}>
                  <span>{t("portal.current_plan")}: {sub.status}</span>
                  {sub.status !== "free" && (
                    <>
                      {" · "}
                      {formatCurrency(sub.amountMinor / 100, sub.currency)}
                      {sub.billingInterval === "year" ? "/year" : "/month"}
                    </>
                  )}
                </div>
                {sub.trialEnd && sub.status === "trialing" && (
                  <div style={{ fontSize: 13, color: "#b45309", marginTop: 4 }}>
                    Trial ends {formatDate(new Date(sub.trialEnd))}
                  </div>
                )}
                {sub.currentPeriodEnd &&
                  ["active", "past_due", "unpaid"].includes(sub.status) && (
                    <div style={{ fontSize: 13, color: "#475569", marginTop: 4 }}>
                      {sub.status === "past_due" || sub.status === "unpaid"
                        ? "Payment failed — update your payment method to keep access."
                        : `Renews ${formatDate(new Date(sub.currentPeriodEnd))}`}
                    </div>
                  )}
                {sub.cancelAtPeriodEnd && sub.status !== "cancelled" && (
                  <div style={{ fontSize: 13, color: "#b45309", marginTop: 4 }}>
                    Cancellation scheduled for period end
                    {sub.currentPeriodEnd
                      ? ` (${formatDate(new Date(sub.currentPeriodEnd))})`
                      : ""}
                  </div>
                )}
              </div>
            </div>
            <div
              style={{
                display: "flex",
                gap: 8,
                marginTop: 12,
                flexWrap: "wrap",
              }}
            >
              {sub.cancelAtPeriodEnd && sub.status !== "cancelled" && (
                <button
                  onClick={() =>
                    runAction("resume", () =>
                      memberApi.resumeSubscription(sub.id),
                    )
                  }
                  disabled={action !== null}
                  style={styles.button}
                >
                  {action === "resume" ? t("portal.saving") : "Resume membership"}
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
                    style={styles.cancelButton}
                  >
                    {action === "cancel"
                      ? t("portal.saving")
                      : t("portal.cancel_sub")}
                  </button>
                )}
              {["active", "past_due", "unpaid"].includes(sub.status) && (
                <button
                  onClick={openBillingPortal}
                  disabled={action !== null}
                  style={styles.button}
                >
                  {action === "portal" ? t("portal.saving") : t("portal.manage_sub")}
                </button>
              )}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  button: {
    padding: "8px 14px",
    backgroundColor: "#2563eb",
    color: "#ffffff",
    border: "none",
    borderRadius: 6,
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  },
  cancelButton: {
    padding: "8px 14px",
    backgroundColor: "#ffffff",
    color: "#dc2626",
    border: "1px solid #fecaca",
    borderRadius: 6,
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  },
};
