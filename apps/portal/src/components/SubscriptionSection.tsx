import { useCallback, useEffect, useState } from 'react';
import { memberApi, MemberSubscription } from '../lib/member-api';
import { navigate } from '../router';

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
      if (err instanceof Error && 'status' in err && (err as { status?: number }).status === 401) authLost();
      else setError(err instanceof Error ? err.message : 'Failed to load subscription');
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
      if (err instanceof Error && 'status' in err && (err as { status?: number }).status === 401) authLost();
      else setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setAction(null);
    }
  };

  const openBillingPortal = async () => {
    setAction('portal');
    setError(null);
    try {
      const res = await memberApi.createBillingPortal();
      window.location.href = res.url;
    } catch (err: unknown) {
      if (err instanceof Error && 'status' in err && (err as { status?: number }).status === 401) authLost();
      else setError(err instanceof Error ? err.message : 'Could not open billing portal');
      setAction(null);
    }
  };

  if (loading) return <p>Loading subscription…</p>;

  return (
    <div style={{ marginTop: 24, paddingTop: 20, borderTop: '1px solid #e2e8f0' }}>
      <h2 style={{ fontSize: 17, fontWeight: 700, margin: '0 0 12px' }}>Membership</h2>
      {error && <p role="alert" style={{ color: '#dc2626', fontSize: 13, margin: '0 0 12px' }}>{error}</p>}

      {subscriptions.length === 0 ? (
        <div>
          <p style={{ fontSize: 14, color: '#475569' }}>You don't have a membership yet.</p>
          <button onClick={() => navigate('/plans')} style={styles.button}>
            View plans
          </button>
        </div>
      ) : (
        subscriptions.map((sub) => (
          <div key={sub.id} style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 16, marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <strong>{sub.planName}</strong>
                <div style={{ fontSize: 13, color: '#475569' }}>
                  {sub.status === 'cancelled' || sub.status === 'expired'
                    ? `Status: ${sub.status}`
                    : `Status: ${sub.status}`}
                  {sub.status !== 'free' && (
                    <>
                      {' · '}
                      {formatAmount(sub.currency, sub.amountMinor)}
                      {sub.billingInterval === 'year' ? '/year' : '/month'}
                    </>
                  )}
                </div>
                {sub.trialEnd && sub.status === 'trialing' && (
                  <div style={{ fontSize: 13, color: '#b45309' }}>
                    Trial ends {new Date(sub.trialEnd).toLocaleDateString()}
                  </div>
                )}
                {sub.currentPeriodEnd && ['active', 'past_due', 'unpaid'].includes(sub.status) && (
                  <div style={{ fontSize: 13, color: '#475569' }}>
                    {sub.status === 'past_due' || sub.status === 'unpaid'
                      ? 'Payment failed — update your payment method to keep access.'
                      : `Renews ${new Date(sub.currentPeriodEnd).toLocaleDateString()}`}
                  </div>
                )}
                {sub.cancelAtPeriodEnd && sub.status !== 'cancelled' && (
                  <div style={{ fontSize: 13, color: '#b45309' }}>
                    Cancellation scheduled for period end{sub.currentPeriodEnd ? ` (${new Date(sub.currentPeriodEnd).toLocaleDateString()})` : ''}
                  </div>
                )}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              {sub.cancelAtPeriodEnd && sub.status !== 'cancelled' && (
                <button
                  onClick={() => runAction('resume', () => memberApi.resumeSubscription(sub.id))}
                  disabled={action !== null}
                  style={styles.button}
                >
                  {action === 'resume' ? 'Resuming…' : 'Resume membership'}
                </button>
              )}
              {!sub.cancelAtPeriodEnd && ['active', 'trialing', 'past_due'].includes(sub.status) && (
                <button
                  onClick={() => runAction('cancel', () => memberApi.cancelSubscription(sub.id))}
                  disabled={action !== null}
                  style={styles.cancelButton}
                >
                  {action === 'cancel' ? 'Cancelling…' : 'Cancel at period end'}
                </button>
              )}
              {['active', 'past_due', 'unpaid'].includes(sub.status) && (
                <button onClick={openBillingPortal} disabled={action !== null} style={styles.button}>
                  {action === 'portal' ? 'Opening…' : 'Billing portal'}
                </button>
              )}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function formatAmount(currency: string, amountMinor: number): string {
  const amount = amountMinor / 100;
  const symbol = currency === 'USD' ? '$' : currency === 'SAR' ? 'SAR ' : `${currency} `;
  return `${symbol}${amount.toFixed(2)}`;
}

const styles: Record<string, React.CSSProperties> = {
  button: {
    padding: '8px 14px',
    backgroundColor: '#2563eb',
    color: '#ffffff',
    border: 'none',
    borderRadius: 6,
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  cancelButton: {
    padding: '8px 14px',
    backgroundColor: '#ffffff',
    color: '#dc2626',
    border: '1px solid #fecaca',
    borderRadius: 6,
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
};
