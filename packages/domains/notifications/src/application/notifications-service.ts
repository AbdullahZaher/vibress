import { NotificationRepository } from '../domain/repository';
import { Notification, CreateNotificationData, ListNotificationsFilter } from '../domain/notification';
import { domainEvents } from '@vibress/events';

export class NotificationsService {
  constructor(private repo: NotificationRepository) {}

  async notify(data: {
    recipientId: string;
    type: string;
    actorMemberId: string | null;
    entityType: string;
    entityId: string;
    data?: Record<string, unknown> | null;
  }): Promise<void> {
    // Never notify about self-actions
    if (data.actorMemberId && data.actorMemberId === data.recipientId) return;

    const notification = await this.repo.create({
      recipientId: data.recipientId,
      type: data.type,
      actorMemberId: data.actorMemberId,
      entityType: data.entityType,
      entityId: data.entityId,
      data: data.data,
    });
    domainEvents.emit('notification.created', { notificationId: notification.id, recipientId: data.recipientId });
  }

  async listNotifications(filter: ListNotificationsFilter): Promise<{ notifications: Notification[]; total: number }> {
    return this.repo.list(filter);
  }

  async countUnread(recipientId: string): Promise<number> {
    return this.repo.countUnread(recipientId);
  }

  async markRead(id: string, recipientId: string): Promise<void> {
    await this.repo.markRead(id, recipientId);
  }

  async markAllRead(recipientId: string): Promise<void> {
    await this.repo.markAllRead(recipientId);
  }
}
