import React, { useEffect, useRef, useState } from 'react';
import { memberApi, MemberApiError } from '../lib/member-api';
import { navigate } from '../router';

type VerifyState = 'verifying' | 'success' | 'error';

export function VerifyPage({ token }: { token: string }) {
  const [state, setState] = useState<VerifyState>('verifying');
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // StrictMode double-invoke guard
    started.current = true;

    (async () => {
      try {
        await memberApi.verifyToken(token);
        setState('success');
        // Navigate first (fires hashchange → router re-renders), then strip the token query.
        navigate('/account');
        window.history.replaceState(null, '', '#/account');
      } catch (err) {
        setState('error');
        if (err instanceof MemberApiError) {
          setErrorCode(err.code || null);
        } else {
          setErrorCode(null);
        }
      }
    })();
  }, [token]);

  if (state === 'verifying') {
    return (
      <div style={styles.container}>
        <p style={styles.status}>Verifying your sign-in link…</p>
      </div>
    );
  }

  if (state === 'success') {
    return (
      <div style={styles.container}>
        <p style={styles.status}>Signed in. Redirecting…</p>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h1 style={styles.title}>Link invalid or expired</h1>
        <p style={styles.subtitle}>
          {errorCode === 'AUTH_TOKEN_USED'
            ? 'This sign-in link has already been used.'
            : errorCode === 'AUTH_TOKEN_EXPIRED'
              ? 'This sign-in link has expired.'
              : 'This sign-in link is no longer valid.'}
        </p>
        <button onClick={() => navigate('/sign-in')} style={styles.button}>
          Request a new link
        </button>
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
    textAlign: 'center',
  },
  title: { margin: 0, fontSize: 22, fontWeight: 700 },
  subtitle: { margin: '8px 0 20px', fontSize: 14, color: '#64748b' },
  status: { fontSize: 14, color: '#475569' },
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
};
