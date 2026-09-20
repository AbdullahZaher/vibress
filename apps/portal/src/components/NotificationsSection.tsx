import { useEffect, useState } from "react";
import {
  memberApi,
  MemberApiError,
  MemberNotification,
} from "../lib/member-api";
import { useTranslation } from "../lib/i18n";
import {
  Card,
  Button,
  Badge,
  Alert,
  Spinner,
  EmptyState,
} from "@vibress/ui";
import { Bell, Check, Inbox, MessageSquare } from "lucide-react";

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

  if (loading) {
    return (
      <div className="py-6 flex items-center justify-center text-muted-foreground gap-2">
        <Spinner size="sm" />
        <span className="text-xs">{t("common.loading")}</span>
      </div>
    );
  }

  return (
    <div className="space-y-3 pt-6 border-t border-border/80 text-start">
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <h3 className="text-sm sm:text-base font-bold tracking-tight text-foreground flex items-center gap-2">
            <Bell className="size-4 text-primary" />
            <span>{t("portal.notifications_title")}</span>
            {unreadCount > 0 && (
              <Badge variant="destructive" className="ms-1.5 px-1.5 py-0 text-[11px] font-mono">
                {unreadCount}
              </Badge>
            )}
          </h3>
        </div>

        {unreadCount > 0 && (
          <Button
            variant="ghost"
            size="xs"
            onClick={handleMarkAllRead}
            className="text-xs text-primary hover:text-primary font-semibold"
          >
            {t("portal.mark_all_read")}
          </Button>
        )}
      </div>

      {error && <Alert variant="destructive">{error}</Alert>}

      {notifications.length === 0 ? (
        <EmptyState
          icon={<Inbox className="size-6" />}
          title={t("portal.no_notifications")}
          className="py-6"
        />
      ) : (
        <div className="space-y-2">
          {notifications.map((n) => (
            <Card
              key={n.id}
              className={`p-3 sm:p-3.5 border transition-colors flex items-center justify-between gap-3 ${
                n.readAt
                  ? "bg-card border-border/60 opacity-80"
                  : "bg-primary/5 border-primary/20 dark:bg-primary/10 shadow-2xs"
              }`}
            >
              <div className="flex items-start gap-2.5 flex-1 min-w-0">
                <div className="size-7 rounded-lg bg-muted/80 text-muted-foreground flex items-center justify-center shrink-0 mt-0.5 border border-border/50">
                  <MessageSquare className="size-3.5 text-primary" />
                </div>
                <div className="space-y-0.5 min-w-0">
                  <p className="text-xs font-semibold text-foreground truncate">
                    {TYPE_LABELS[n.type] || n.type}
                  </p>
                  <p className="text-[11px] text-muted-foreground font-mono">
                    {formatDate(new Date(n.createdAt))}
                  </p>
                </div>
              </div>

              {!n.readAt && (
                <Button
                  size="icon-sm"
                  variant="outline"
                  onClick={() => handleMarkRead(n.id)}
                  title="Mark as read"
                  aria-label="Mark notification as read"
                  className="size-7 shrink-0 rounded-md border-border/80 text-muted-foreground hover:text-foreground hover:bg-muted"
                >
                  <Check className="size-3.5" />
                </Button>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
