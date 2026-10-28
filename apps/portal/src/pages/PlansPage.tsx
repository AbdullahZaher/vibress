import { useEffect, useState } from "react";
import {
  fetchProducts,
  formatPrice,
  PublicPlan,
  PublicProduct,
} from "../lib/catalog";
import { memberApi } from "../lib/member-api";
import { navigate } from "../router";
import { Shell } from "../components/Shell";

export function PlansPage() {
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
      setError(err instanceof Error ? err.message : "Failed to start checkout");
      setStarting(null);
    }
  };

  const nav = (
    <button className="ap-nav-link" onClick={() => navigate("/account")}>
      Account
    </button>
  );

  if (loading) {
    return (
      <Shell nav={nav}>
        <div className="ap-skeleton" style={{ height: 120 }} />
      </Shell>
    );
  }

  return (
    <Shell nav={nav}>
      <p className="ap-eyebrow">Membership</p>
      <h1 className="ap-title">Choose your plan.</h1>
      <p className="ap-sub">Pick the plan that fits you. Change or cancel anytime.</p>

      {error && (
        <p role="alert" className="ap-alert bad" style={{ marginTop: 24 }}>
          {error}
        </p>
      )}
      {products.length === 0 && !error && (
        <div className="ap-group" style={{ marginTop: 32 }}>
          <p className="ap-empty">No plans available yet.</p>
        </div>
      )}

      {products.map((product) => (
        <section key={product.id} className="ap-section">
          <h2 className="ap-section-title">{product.name}</h2>
          {product.description && <p className="ap-sub" style={{ fontSize: 15 }}>{product.description}</p>}
          <div className="ap-plans">
            {product.plans.map((plan) => (
              <article key={plan.id} className="ap-plan">
                <h3 className="ap-plan-name">{plan.name}</h3>
                <p className="ap-plan-desc">{plan.description}</p>
                <p className="ap-plan-price">{formatPrice(plan)}</p>
                <p className="ap-plan-trial">
                  {plan.trialDays > 0 ? `${plan.trialDays}-day free trial` : "\u00A0"}
                </p>
                <button
                  onClick={() => startCheckout(plan)}
                  disabled={starting === plan.id}
                  className="ap-btn ap-btn-block"
                >
                  {starting === plan.id
                    ? "Starting…"
                    : plan.billingType === "free"
                      ? "Get started"
                      : "Subscribe"}
                </button>
              </article>
            ))}
          </div>
        </section>
      ))}
    </Shell>
  );
}
