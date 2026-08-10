import { useEffect, useState } from 'react';
import { fetchProducts, formatPrice, PublicPlan, PublicProduct } from '../lib/catalog';
import { memberApi } from '../lib/member-api';
import { navigate } from '../router';

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
      setError(err instanceof Error ? err.message : 'Failed to start checkout');
      setStarting(null);
    }
  };

  if (loading) return <div className="page-card">Loading plans…</div>;

  return (
    <div className="page-card">
      <h1>Choose your plan</h1>
      {error && <div className="form-error">{error}</div>}
      {products.length === 0 && <p>No plans available yet.</p>}
      {products.map((product) => (
        <section key={product.id} style={{ marginBottom: 32 }}>
          <h2>{product.name}</h2>
          {product.description && <p>{product.description}</p>}
          <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
            {product.plans.map((plan) => (
              <div key={plan.id} style={{ border: '1px solid #ddd', borderRadius: 8, padding: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <strong>{plan.name}</strong>
                    {plan.description && <div style={{ fontSize: 14 }}>{plan.description}</div>}
                    <div style={{ fontSize: 14, color: '#555' }}>{formatPrice(plan)}</div>
                    {plan.trialDays > 0 && <div style={{ fontSize: 13, color: '#2a7' }}>{plan.trialDays}-day free trial</div>}
                  </div>
                  <button
                    onClick={() => startCheckout(plan)}
                    disabled={starting === plan.id}
                    className="button button-primary"
                  >
                    {starting === plan.id ? 'Starting…' : plan.billingType === 'free' ? 'Get started' : 'Subscribe'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
      <button className="link-button" onClick={() => navigate('/account')}>
        Back to account
      </button>
    </div>
  );
}
