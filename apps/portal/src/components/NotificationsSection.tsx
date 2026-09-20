import { useEffect, useState } from "react";
import {
  memberApi,
  MemberApiError,
  MemberNotification,
} from "../lib/member-api";
import { useTranslation } from "../lib/i18n";

interface Props {
  authLost: () => void;
}

const TYPE_LABELS: Record<string, string> = {
  "comment.reply": "replied to your comment",
  "comment.hidden": "Your comment was hidden by moderation",
};

export function NotificationsSection({ authLost }: Props) {
  const { t, formatDate } = useTranslation();
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
          err instanceof Error ? err.message : t("common.error"),
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

  if (loading) return <p style={{ color: "#64748b", fontSize: 14 }}>{t("common.loading")}</p>;

  return (
    <div
      style={{ marginTop: 24, paddingTop: 20, borderTop: "1px solid #e2e8f0" }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 12,
        }}
      >
        <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0, textAlign: "start" }}>
          {t("portal.notifications_title")}{" "}
          {unreadCount > 0 && (
            <span style={{ fontSize: 13, color: "#dc2626", marginInlineStart: 8 }}>
              ({unreadCount})
            </span>
          )}
        </h2>
        {unreadCount > 0 && (
          <button
            onClick={handleMarkAllRead}
            style={{
              fontSize: 13,
              color: "#2563eb",
              background: "none",
              border: "none",
              cursor: "pointer",
            }}
          >
            {t("portal.mark_all_read")}
          </button>
        )}
      </div>
      {error && (
        <p
          role="alert"
          style={{ color: "#dc2626", fontSize: 13, margin: "0 0 12px", textAlign: "start" }}
        >
          {error}
        </p>
      )}
      {notifications.length === 0 ? (
        <p style={{ fontSize: 14, color: "#475569", textAlign: "start" }}>{t("portal.no_notifications")}</p>
      ) : (
        notifications.map((n) => (
          <div
            key={n.id}
            style={{
              padding: "10px 12px",
              marginBottom: 8,
              borderRadius: 6,
              border: "1px solid #e2e8f0",
              backgroundColor: n.readAt ? "#ffffff" : "#f0fdf4",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              textAlign: "start",
            }}
          >
            <div style={{ flex: 1, marginInlineEnd: 12 }}>
              <div style={{ fontSize: 13, color: "#0f172a" }}>
                {TYPE_LABELS[n.type] || n.type}
              </div>
              <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>
                {formatDate(new Date(n.createdAt))}
              </div>
            </div>
            {!n.readAt && (
              <button
                onClick={() => handleMarkRead(n.id)}
                style={{
                  fontSize: 12,
                  color: "#2563eb",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                ✓
              </button>
            )}
          </div>
        ))
      )}
    </div>
  );
}
