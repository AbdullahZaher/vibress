import { useEffect, useState } from "react";
import {
  fetchProducts,
  formatPrice,
  PublicPlan,
  PublicProduct,
} from "../lib/catalog";
import { memberApi } from "../lib/member-api";
import { navigate } from "../router";
import { useTranslation, LanguageSwitcher } from "../lib/i18n";

export function PlansPage() {
  const { t } = useTranslation();
  const [products, setProducts] = useState<PublicProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState<string | null>(null);

  useEffect(() => {
    fetchProducts()
      .then(setProducts)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const startCheckout = async (plan: PublicPlan) => {
    setStarting(plan.id);
    setError(null);
    try {
      const { checkoutUrl } = await memberApi.createCheckout(plan.id);
      window.location.href = checkoutUrl;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t("common.error"));
      setStarting(null);
    }
  };

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>{t("common.loading")}</div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h1 style={{ ...styles.title, margin: 0 }}>{t("portal.plans_title")}</h1>
          <LanguageSwitcher />
        </div>

        <p style={styles.subtitle}>{t("portal.plans_desc")}</p>

        {error && <div style={styles.error}>{error}</div>}
        {products.length === 0 && <p style={{ color: "#64748b", textAlign: "start" }}>No plans available yet.</p>}

        {products.map((product) => (
          <section key={product.id} style={{ marginBottom: 24, textAlign: "start" }}>
            <h2 style={{ fontSize: 18, fontWeight: 600, margin: "0 0 4px" }}>{product.name}</h2>
            {product.description && <p style={{ fontSize: 13, color: "#64748b", margin: "0 0 12px" }}>{product.description}</p>}
            <div style={{ display: "grid", gap: 12 }}>
              {product.plans.map((plan) => (
                <div
                  key={plan.id}
                  style={{
                    border: "1px solid #e2e8f0",
                    borderRadius: 8,
                    padding: 16,
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
                      <strong>{plan.name}</strong>
                      {plan.description && (
                        <div style={{ fontSize: 13, color: "#64748b", marginTop: 2 }}>{plan.description}</div>
                      )}
                      <div style={{ fontSize: 14, color: "#334155", fontWeight: 600, marginTop: 4 }}>
                        {formatPrice(plan)}
                      </div>
                      {plan.trialDays > 0 && (
                        <div style={{ fontSize: 12, color: "#16a34a", marginTop: 2 }}>
                          {plan.trialDays}-day free trial
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => startCheckout(plan)}
                      disabled={starting === plan.id}
                      style={styles.button}
                    >
                      {starting === plan.id
                        ? t("portal.saving")
                        : t("portal.select_plan")}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}

        <button
          onClick={() => navigate("/account")}
          style={styles.secondaryButton}
        >
          {t("portal.account_title")}
        </button>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f8fafc",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans Arabic", sans-serif',
    padding: "32px 16px",
    boxSizing: "border-box",
  },
  card: {
    width: "100%",
    maxWidth: 540,
    padding: 32,
    backgroundColor: "#ffffff",
    borderRadius: 12,
    boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
    boxSizing: "border-box",
  },
  title: { fontSize: 22, fontWeight: 700, textAlign: "start" },
  subtitle: {
    margin: "0 0 24px",
    fontSize: 14,
    color: "#64748b",
    textAlign: "start",
  },
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
  secondaryButton: {
    marginTop: 16,
    padding: "8px 14px",
    backgroundColor: "#f1f5f9",
    color: "#475569",
    border: "none",
    borderRadius: 6,
    fontSize: 13,
    fontWeight: 500,
    cursor: "pointer",
  },
  error: { color: "#dc2626", fontSize: 13, margin: "0 0 12px", textAlign: "start" },
};
