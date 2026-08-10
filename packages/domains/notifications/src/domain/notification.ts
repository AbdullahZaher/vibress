export interface Notification {
  id: string;
  recipientType: string;
  recipientId: string;
  type: string;
  actorMemberId: string | null;
  entityType: string;
  entityId: string;
  data: Record<string, unknown> | null;
  readAt: Date | null;
  createdAt: Date;
}

export interface CreateNotificationData {
  id?: string | undefined;
  recipientId: string;
  type: string;
  actorMemberId?: string | null | undefined;
  entityType: string;
  entityId: string;
  data?: Record<string, unknown> | null | undefined;
}

export interface ListNotificationsFilter {
  recipientId: string;
  unreadOnly?: boolean | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}
