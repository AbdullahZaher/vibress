import React, { useEffect, useState } from 'react';
import { memberApi, MemberApiError, MemberSelf } from '../lib/member-api';
import { navigate } from '../router';
import { SubscriptionSection } from '../components/SubscriptionSection';
import { NewsletterPreferencesSection } from '../components/NewsletterPreferencesSection';
import { NotificationsSection } from '../components/NotificationsSection';

export function AccountPage() {
  const [member, setMember] = useState<MemberSelf | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState(false);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await memberApi.me();
        setMember(res.member);
        setName(res.member.name || '');
      } catch (err) {
        if (err instanceof MemberApiError && (err.status === 401 || err.status === 0)) {
          setAuthError(true);
        } else {
          setAuthError(true);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    setMessage(null);
    try {
      const res = await memberApi.updateProfile(name.trim() || null);
      setMember(res.member);
      setName(res.member.name || '');
      setMessage('Profile updated.');
    } catch (err) {
      if (err instanceof MemberApiError && err.status === 401) {
        setAuthError(true);
      } else {
        setSaveError('Failed to update profile.');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = async () => {
    try {
      await memberApi.logout();
    } catch {
      // Ignore logout errors; always redirect
    }
    navigate('/sign-in');
  };

  if (loading) {
    return (
      <div style={styles.container}>
        <p style={styles.status}>Loading…</p>
      </div>
    );
  }

  if (authError || !member) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <h1 style={styles.title}>Your session is no longer valid</h1>
          <button onClick={() => navigate('/sign-in')} style={styles.button}>
            Sign in
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h1 style={styles.title}>Your account</h1>

        <div style={styles.field}>
          <label style={styles.label}>Email</label>
          <p style={styles.value}>{member.email}</p>
        </div>

        <div style={styles.field}>
          <label style={styles.label}>Email verified</label>
          <p style={styles.value}>{member.emailVerified ? 'Yes' : 'No'}</p>
        </div>

        <div style={styles.field}>
          <label style={styles.label}>Member since</label>
          <p style={styles.value}>
            {new Date(member.createdAt).toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
          </p>
        </div>

        <form onSubmit={handleSave}>
          <label style={styles.label} htmlFor="name">
            Name
          </label>
          <input
            id="name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={styles.input}
            maxLength={200}
          />
          {saveError && <p role="alert" style={styles.error}>{saveError}</p>}
          {message && <p role="status" style={styles.success}>{message}</p>}
          <button type="submit" disabled={saving} style={styles.button}>
            {saving ? 'Saving…' : 'Save profile'}
          </button>
        </form>

        <SubscriptionSection authLost={() => setAuthError(true)} />
        <NewsletterPreferencesSection authLost={() => setAuthError(true)} />
        <NotificationsSection authLost={() => setAuthError(true)} />

        <button onClick={handleLogout} style={styles.logout}>
          Sign out
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
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 480,
    padding: 32,
    backgroundColor: '#ffffff',
    borderRadius: 12,
    boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
    boxSizing: 'border-box',
  },
  title: { margin: '0 0 20px', fontSize: 22, fontWeight: 700 },
  field: { marginBottom: 16 },
  label: { display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4, color: '#475569' },
  value: { margin: 0, fontSize: 15, color: '#0f172a' },
  input: {
    width: '100%',
    padding: '10px 12px',
    borderRadius: 8,
    border: '1px solid #cbd5e1',
    fontSize: 14,
    boxSizing: 'border-box',
    marginBottom: 12,
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
  logout: {
    width: '100%',
    padding: '11px 16px',
    backgroundColor: '#ffffff',
    color: '#dc2626',
    border: '1px solid #fecaca',
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    marginTop: 12,
  },
  error: { color: '#dc2626', fontSize: 13, margin: '0 0 12px' },
  success: { color: '#166534', fontSize: 13, margin: '0 0 12px' },
  status: { fontSize: 14, color: '#475569' },
};
