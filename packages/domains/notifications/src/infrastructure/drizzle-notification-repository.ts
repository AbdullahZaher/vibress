import { getDb, notifications, NotificationRow } from '@vibress/database';
import { eq, and, isNull, desc, count, sql } from 'drizzle-orm';
import crypto from 'node:crypto';
import { NotificationRepository } from '../domain/repository';
import { Notification, CreateNotificationData, ListNotificationsFilter } from '../domain/notification';

export class DrizzleNotificationRepository implements NotificationRepository {
  async create(data: CreateNotificationData): Promise<Notification> {
    const db = getDb();
    const [row] = await db
      .insert(notifications)
      .values({
        id: data.id || crypto.randomUUID(),
        recipientType: 'member',
        recipientId: data.recipientId,
        type: data.type,
        actorMemberId: data.actorMemberId || null,
        entityType: data.entityType,
        entityId: data.entityId,
        data: data.data || null,
        createdAt: new Date(),
      })
      .returning();
    if (!row) throw new Error('Failed to insert notification');
    return this.mapToDomain(row);
  }

  async findById(id: string): Promise<Notification | null> {
    const db = getDb();
    const rows = await db.select().from(notifications).where(eq(notifications.id, id)).limit(1);
    const row = rows[0];
    if (!row) return null;
    return this.mapToDomain(row);
  }

  async list(filter: ListNotificationsFilter): Promise<{ notifications: Notification[]; total: number }> {
    const db = getDb();
    const limit = Math.min(filter.limit || 20, 100);
    const offset = filter.offset || 0;
    const conditions = [
      eq(notifications.recipientId, filter.recipientId),
      eq(notifications.recipientType, 'member'),
    ];
    if (filter.unreadOnly) conditions.push(isNull(notifications.readAt));
    const whereClause = and(...conditions);

    const countRes = await db.select({ total: count() }).from(notifications).where(whereClause);
    const rows = await db
      .select()
      .from(notifications)
      .where(whereClause)
      .orderBy(desc(notifications.createdAt))
      .limit(limit)
      .offset(offset);

    return {
      notifications: rows.map((r) => this.mapToDomain(r)),
      total: Number(countRes[0]?.total || 0),
    };
  }

  async countUnread(recipientId: string): Promise<number> {
    const db = getDb();
    const rows = await db
      .select({ total: count() })
      .from(notifications)
      .where(and(
        eq(notifications.recipientId, recipientId),
        eq(notifications.recipientType, 'member'),
        isNull(notifications.readAt),
      ));
    return Number(rows[0]?.total || 0);
  }

  async markRead(id: string, recipientId: string): Promise<void> {
    const db = getDb();
    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.id, id), eq(notifications.recipientId, recipientId)));
  }

  async markAllRead(recipientId: string): Promise<void> {
    const db = getDb();
    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(
        eq(notifications.recipientId, recipientId),
        eq(notifications.recipientType, 'member'),
        isNull(notifications.readAt),
      ));
  }

  private mapToDomain(row: NotificationRow): Notification {
    return {
      id: row.id,
      recipientType: row.recipientType,
      recipientId: row.recipientId,
      type: row.type,
      actorMemberId: row.actorMemberId || null,
      entityType: row.entityType,
      entityId: row.entityId,
      data: row.data as Record<string, unknown> | null,
      readAt: row.readAt,
      createdAt: row.createdAt,
    };
  }
}
