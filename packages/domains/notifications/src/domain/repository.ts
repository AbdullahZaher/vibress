import { Notification, CreateNotificationData, ListNotificationsFilter } from './notification';

export interface NotificationRepository {
  create(data: CreateNotificationData): Promise<Notification>;
  findById(id: string): Promise<Notification | null>;
  list(filter: ListNotificationsFilter): Promise<{ notifications: Notification[]; total: number }>;
  countUnread(recipientId: string): Promise<number>;
  markRead(id: string, recipientId: string): Promise<void>;
  markAllRead(recipientId: string): Promise<void>;
}
