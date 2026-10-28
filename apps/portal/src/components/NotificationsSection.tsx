import { useEffect, useState } from "react";
import {
  memberApi,
  MemberApiError,
  MemberNotification,
} from "../lib/member-api";

interface Props {
  authLost: () => void;
}

const TYPE_LABELS: Record<string, string> = {
  "comment.reply": "replied to your comment",
  "comment.hidden": "Your comment was hidden by moderation",
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
      if (
        err instanceof MemberApiError &&
        (err.status === 401 || err.status === 0)
      ) {
        authLost();
      } else {
        setError(
          err instanceof Error ? err.message : "Failed to load notifications",
        );
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

  if (loading) {
    return (
      <section className="ap-section">
        <div className="ap-skeleton" />
      </section>
    );
  }

  return (
    <section className="ap-section" aria-labelledby="notif-h">
      <div className="ap-section-head">
        <h2 className="ap-section-title" id="notif-h">
          Notifications
          {unreadCount > 0 && <span className="ap-badge">{unreadCount}</span>}
        </h2>
        {unreadCount > 0 && (
          <button className="ap-link" onClick={handleMarkAllRead}>
            Mark all read
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="ap-alert bad">
          {error}
        </p>
      )}
      <div className="ap-group">
        {notifications.length === 0 ? (
          <p className="ap-empty">You're all caught up.</p>
        ) : (
          notifications.map((n) => (
            <div key={n.id} className={`ap-row${n.readAt ? "" : " ap-unread"}`}>
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                {!n.readAt && <span className="ap-dot" aria-label="Unread" />}
                <div>
                  <div className="ap-row-label">
                    {TYPE_LABELS[n.type] || n.type}
                  </div>
                  <div className="ap-row-meta">
                    {new Date(n.createdAt).toLocaleString()}
                  </div>
                </div>
              </div>
              {!n.readAt && (
                <button className="ap-link" onClick={() => handleMarkRead(n.id)}>
                  Mark read
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </section>
  );
}
