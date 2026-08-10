import { useEffect, useState } from 'react';
import { memberApi, MemberApiError, MemberNotification } from '../lib/member-api';

interface Props {
  authLost: () => void;
}

const TYPE_LABELS: Record<string, string> = {
  'comment.reply': 'replied to your comment',
  'comment.hidden': 'Your comment was hidden by moderation',
};

export function NotificationsSection({ authLost }: Props) {
  const [notifications, setNotifications] = useState<MemberNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const [listRes, countRes] = await Promise.all([
        memberApi.listNotifications(),
        memberApi.getUnreadCount(),
      ]);
      setNotifications(listRes.notifications);
      setUnreadCount(countRes.count);
      setError(null);
    } catch (err: unknown) {
      if (err instanceof MemberApiError && (err.status === 401 || err.status === 0)) {
        authLost();
      } else {
        setError(err instanceof Error ? err.message : 'Failed to load notifications');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const handleMarkAllRead = async () => {
    try {
      await memberApi.markAllNotificationsRead();
      await refresh();
    } catch (err: unknown) {
      if (err instanceof MemberApiError && err.status === 401) authLost();
    }
  };

  const handleMarkRead = async (id: string) => {
    try {
      await memberApi.markNotificationRead(id);
      await refresh();
    } catch (err: unknown) {
      if (err instanceof MemberApiError && err.status === 401) authLost();
    }
  };

  if (loading) return <p>Loading notifications…</p>;

  return (
    <div style={{ marginTop: 24, paddingTop: 20, borderTop: '1px solid #e2e8f0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>
          Notifications {unreadCount > 0 && <span style={{ fontSize: 13, color: '#dc2626', marginLeft: 8 }}>{unreadCount} unread</span>}
        </h2>
        {unreadCount > 0 && (
          <button onClick={handleMarkAllRead} style={{ fontSize: 13, color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer' }}>
            Mark all read
          </button>
        )}
      </div>
      {error && <p role="alert" style={{ color: '#dc2626', fontSize: 13, margin: '0 0 12px' }}>{error}</p>}
      {notifications.length === 0 ? (
        <p style={{ fontSize: 14, color: '#475569' }}>No notifications.</p>
      ) : (
        notifications.map((n) => (
          <div
            key={n.id}
            style={{
              padding: '12px 16px',
              marginBottom: 8,
              borderRadius: 8,
              border: '1px solid #e2e8f0',
              backgroundColor: n.readAt ? '#ffffff' : '#f0f7ff',
              fontSize: 14,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>{TYPE_LABELS[n.type] || n.type}</span>
              {!n.readAt && (
                <button
                  onClick={() => handleMarkRead(n.id)}
                  style={{ fontSize: 12, color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer' }}
                >
                  Mark read
                </button>
              )}
            </div>
            <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>
              {new Date(n.createdAt).toLocaleString()}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
