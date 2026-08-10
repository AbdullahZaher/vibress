import React, { useState } from 'react';
import { memberApi, MemberApiError } from '../lib/member-api';
import { navigate } from '../router';

export function SignInPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await memberApi.requestAuthLink(email);
      navigate('/check-email');
    } catch (err) {
      if (err instanceof MemberApiError && err.status === 429) {
        setError('Too many requests. Please try again shortly.');
      } else {
        setError('Something went wrong. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h1 style={styles.title}>Vibress</h1>
        <p style={styles.subtitle}>Sign in with your email</p>

        <form onSubmit={handleSubmit}>
          <label style={styles.label} htmlFor="email">
            Email Address
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
            style={styles.input}
          />

          {error && <p role="alert" style={styles.error}>{error}</p>}

          <button type="submit" disabled={submitting} style={styles.button}>
            {submitting ? 'Sending…' : 'Continue'}
          </button>
        </form>

        <p style={styles.hint}>
          We'll email you a secure sign-in link. No password needed.
        </p>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f8fafc',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  card: {
    width: '100%',
    maxWidth: 400,
    padding: 32,
    backgroundColor: '#ffffff',
    borderRadius: 12,
    boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
    boxSizing: 'border-box',
  },
  title: { margin: 0, fontSize: 24, fontWeight: 700, textAlign: 'center' },
  subtitle: { margin: '8px 0 24px', fontSize: 14, color: '#64748b', textAlign: 'center' },
  label: { display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 },
  input: {
    width: '100%',
    padding: '10px 12px',
    borderRadius: 8,
    border: '1px solid #cbd5e1',
    fontSize: 14,
    boxSizing: 'border-box',
    marginBottom: 16,
  },
  button: {
    width: '100%',
    padding: '11px 16px',
    backgroundColor: '#2563eb',
    color: '#ffffff',
    border: 'none',
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
  },
  error: { color: '#dc2626', fontSize: 13, margin: '0 0 12px' },
  hint: { marginTop: 20, fontSize: 12, color: '#94a3b8', textAlign: 'center' },
};
