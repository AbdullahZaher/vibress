import React, { useState } from 'react';
import { memberApi, MemberApiError } from '../lib/member-api';
import { navigate } from '../router';

export function CheckEmailPage() {
  const [email, setEmail] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const [message, setMessage] = useState<string | null>(null);

  const handleResend = async () => {
    if (cooldown > 0 || !email) return;
    try {
      await memberApi.requestAuthLink(email);
      setMessage('A new sign-in link has been sent.');
      setCooldown(30);
      const timer = setInterval(() => {
        setCooldown((c) => {
          if (c <= 1) {
            clearInterval(timer);
            return 0;
          }
          return c - 1;
        });
      }, 1000);
    } catch (err) {
      if (err instanceof MemberApiError && err.status === 429) {
        setMessage('Too many requests. Please wait a moment.');
      } else {
        setMessage('Something went wrong. Please try again.');
      }
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h1 style={styles.title}>Check your email</h1>
        <p style={styles.subtitle}>
          We sent you a secure sign-in link. Open it in this browser to continue.
        </p>

        <input
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          style={styles.input}
        />

        {message && <p role="status" style={styles.message}>{message}</p>}
        <button
          onClick={handleResend}
          disabled={cooldown > 0 || !email}
          style={styles.button}
        >
          {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend link'}
        </button>

        <p style={styles.hint}>
          <a href="#" onClick={(e) => { e.preventDefault(); navigate('/sign-in'); }} style={styles.link}>
            Use a different email
          </a>
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
    textAlign: 'center',
  },
  title: { margin: 0, fontSize: 22, fontWeight: 700 },
  subtitle: { margin: '8px 0 20px', fontSize: 14, color: '#64748b' },
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
  message: { color: '#166534', fontSize: 13, margin: '0 0 12px' },
  hint: { marginTop: 20, fontSize: 13 },
  link: { color: '#2563eb', textDecoration: 'none' },
};
