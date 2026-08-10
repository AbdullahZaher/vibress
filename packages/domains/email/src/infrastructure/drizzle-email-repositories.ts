import { getDb, emailRecipients, EmailRecipientRow, emailEvents, emailSuppressions, EmailEventRow, EmailSuppressionRow, providerEvents, ProviderEventRow } from '@vibress/database';
import { eq, and, count, desc, sql } from 'drizzle-orm';
import crypto from 'node:crypto';
import {
  EmailRecipientRepository,
  EmailEventRepository,
  EmailSuppressionRepository,
  EmailRecipient,
  CreateRecipientData,
  EmailEvent,
  SuppressionReason,
  EmailSuppression,
} from '../domain/recipient';
import { RecipientStatus } from '../domain/recipient-status';
import { ProviderEventRecord, ProviderEventRepository } from '../application/email-service';

export class DrizzleEmailRecipientRepository implements EmailRecipientRepository {
  async createMany(rows: CreateRecipientData[]): Promise<number> {
    if (rows.length === 0) return 0;
    const db = getDb();
    const now = new Date();
    const values = rows.map((r) => ({
      id: r.id || crypto.randomUUID(),
      sendId: r.sendId,
      memberId: r.memberId,
      email: r.email,
      name: r.name || null,
      status: 'pending' as const,
      unsubscribeToken: r.unsubscribeToken,
      createdAt: now,
      updatedAt: now,
    }));
    const result = await db.insert(emailRecipients).values(values).returning({ id: emailRecipients.id });
    return result.length;
  }

  async findPending(sendId: string, limit: number): Promise<EmailRecipient[]> {
    const db = getDb();
    const rows = await db
      .select()
      .from(emailRecipients)
      .where(and(eq(emailRecipients.sendId, sendId), eq(emailRecipients.status, 'pending')))
      .limit(limit);
    return rows.map((r) => this.mapToDomain(r));
  }

  async findById(id: string): Promise<EmailRecipient | null> {
    const db = getDb();
    const rows = await db.select().from(emailRecipients).where(eq(emailRecipients.id, id)).limit(1);
    const row = rows[0];
    if (!row) return null;
    return this.mapToDomain(row);
  }

  async findByMessageId(messageId: string): Promise<EmailRecipient | null> {
    const db = getDb();
    const normalized = messageId.trim().replace(/^<|>$/g, '');
    const rows = await db
      .select()
      .from(emailRecipients)
      .where(
        sql`${emailRecipients.providerMessageId} IS NOT NULL AND (${emailRecipients.providerMessageId} = ${messageId} OR ${emailRecipients.providerMessageId} = ${`<${normalized}>`})`
      )
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return this.mapToDomain(row);
  }

  async findByEmailAndSend(email: string, sendId: string): Promise<EmailRecipient | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(emailRecipients)
      .where(and(eq(emailRecipients.email, email), eq(emailRecipients.sendId, sendId)))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return this.mapToDomain(row);
  }

  async markSent(id: string, messageId: string, at: Date): Promise<EmailRecipient> {
    const db = getDb();
    const [row] = await db
      .update(emailRecipients)
      .set({ status: 'sent', providerMessageId: messageId, sentAt: at, updatedAt: new Date() })
      .where(eq(emailRecipients.id, id))
      .returning();
    if (!row) throw new Error(`Recipient not found: ${id}`);
    return this.mapToDomain(row);
  }

  async markFailed(id: string, error: string, attemptCount: number): Promise<EmailRecipient> {
    const db = getDb();
    const [row] = await db
      .update(emailRecipients)
      .set({ status: 'failed', lastError: error.slice(0, 500), attemptCount, updatedAt: new Date() })
      .where(eq(emailRecipients.id, id))
      .returning();
    if (!row) throw new Error(`Recipient not found: ${id}`);
    return this.mapToDomain(row);
  }

  async markDelivered(id: string, at: Date): Promise<EmailRecipient> {
    const db = getDb();
    const [row] = await db
      .update(emailRecipients)
      .set({ status: 'delivered', deliveredAt: at, updatedAt: new Date() })
      .where(eq(emailRecipients.id, id))
      .returning();
    if (!row) throw new Error(`Recipient not found: ${id}`);
    return this.mapToDomain(row);
  }

  async markOpened(id: string, at: Date): Promise<EmailRecipient> {
    const db = getDb();
    const [row] = await db
      .update(emailRecipients)
      .set({ openedAt: at, updatedAt: new Date() })
      .where(eq(emailRecipients.id, id))
      .returning();
    if (!row) throw new Error(`Recipient not found: ${id}`);
    return this.mapToDomain(row);
  }

  async markClicked(id: string, at: Date): Promise<EmailRecipient> {
    const db = getDb();
    const [row] = await db
      .update(emailRecipients)
      .set({ clickedAt: at, updatedAt: new Date() })
      .where(eq(emailRecipients.id, id))
      .returning();
    if (!row) throw new Error(`Recipient not found: ${id}`);
    return this.mapToDomain(row);
  }

  async countByStatus(sendId: string): Promise<Record<string, number>> {
    const db = getDb();
    const rows = await db
      .select({ status: emailRecipients.status, total: count() })
      .from(emailRecipients)
      .where(eq(emailRecipients.sendId, sendId))
      .groupBy(emailRecipients.status);
    const result: Record<string, number> = {};
    for (const row of rows) result[row.status] = Number(row.total);
    return result;
  }

  private mapToDomain(row: EmailRecipientRow): EmailRecipient {
    return {
      id: row.id,
      sendId: row.sendId,
      memberId: row.memberId,
      email: row.email,
      name: row.name || null,
      status: row.status as RecipientStatus,
      providerMessageId: row.providerMessageId,
      unsubscribeToken: row.unsubscribeToken,
      attemptCount: row.attemptCount,
      lastError: row.lastError,
      sentAt: row.sentAt,
      deliveredAt: row.deliveredAt,
      openedAt: row.openedAt,
      clickedAt: row.clickedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

export class DrizzleEmailEventRepository implements EmailEventRepository {
  async record(data: {
    recipientId: string;
    sendId?: string | null | undefined;
    memberId?: string | null | undefined;
    type: string;
    provider?: string | null | undefined;
    providerEventId?: string | null | undefined;
    data?: Record<string, unknown> | null | undefined;
  }): Promise<EmailEvent> {
    const db = getDb();
    const [row] = await db
      .insert(emailEvents)
      .values({
        id: crypto.randomUUID(),
        recipientId: data.recipientId,
        sendId: data.sendId || null,
        memberId: data.memberId || null,
        type: data.type,
        provider: data.provider || null,
        providerEventId: data.providerEventId || null,
        occurredAt: new Date(),
        data: data.data || null,
        createdAt: new Date(),
      })
      .returning();
    if (!row) throw new Error('Failed to record email event');
    return this.mapToDomain(row);
  }

  private mapToDomain(row: EmailEventRow): EmailEvent {
    return {
      id: row.id,
      recipientId: row.recipientId,
      sendId: row.sendId,
      memberId: row.memberId,
      type: row.type,
      provider: row.provider,
      providerEventId: row.providerEventId,
      occurredAt: row.occurredAt,
      data: row.data as Record<string, unknown> | null,
    };
  }
}

export class DrizzleProviderEventRepository implements ProviderEventRepository {
  async create(data: { id?: string | undefined; provider: string; providerEventId: string; eventType: string; payloadHash: string }): Promise<ProviderEventRecord> {
    const db = getDb();
    const [row] = await db
      .insert(providerEvents)
      .values({
        id: data.id || crypto.randomUUID(),
        provider: data.provider,
        providerEventId: data.providerEventId,
        eventType: data.eventType,
        payloadHash: data.payloadHash,
        status: 'received',
        attemptCount: 0,
        receivedAt: new Date(),
      })
      .returning();
    if (!row) throw new Error('Failed to insert provider event');
    return this.mapToDomain(row);
  }

  async findByProviderEventId(provider: string, providerEventId: string): Promise<ProviderEventRecord | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(providerEvents)
      .where(and(eq(providerEvents.provider, provider), eq(providerEvents.providerEventId, providerEventId)))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return this.mapToDomain(row);
  }

  async markProcessed(id: string, processedAt = new Date()): Promise<void> {
    const db = getDb();
    await db.update(providerEvents).set({ status: 'processed', processedAt }).where(eq(providerEvents.id, id));
  }

  async markFailed(id: string, error: string, attemptCount: number): Promise<void> {
    const db = getDb();
    await db
      .update(providerEvents)
      .set({ status: 'failed', lastError: error.slice(0, 500), attemptCount })
      .where(eq(providerEvents.id, id));
  }

  private mapToDomain(row: ProviderEventRow): ProviderEventRecord {
    return {
      id: row.id,
      provider: row.provider,
      providerEventId: row.providerEventId,
      eventType: row.eventType,
      status: row.status,
      attemptCount: row.attemptCount,
      lastError: row.lastError,
      payloadHash: row.payloadHash,
      receivedAt: row.receivedAt,
      processedAt: row.processedAt,
    };
  }
}

export class DrizzleEmailSuppressionRepository implements EmailSuppressionRepository {
  async add(data: {
    memberId?: string | null | undefined;
    email: string;
    reason: SuppressionReason;
    source: string;
    detail?: string | null | undefined;
  }): Promise<void> {
    const db = getDb();
    const email = data.email.trim().toLowerCase();
    await db
      .insert(emailSuppressions)
      .values({
        id: crypto.randomUUID(),
        memberId: data.memberId || null,
        email,
        reason: data.reason,
        source: data.source,
        detail: data.detail || null,
        createdAt: new Date(),
      })
      .onConflictDoNothing();
  }

  async isSuppressed(email: string): Promise<boolean> {
    const db = getDb();
    const rows = await db.select({ id: emailSuppressions.id }).from(emailSuppressions).where(eq(emailSuppressions.email, email.trim().toLowerCase())).limit(1);
    return rows.length > 0;
  }

  async findByEmail(email: string): Promise<EmailSuppression | null> {
    const db = getDb();
    const rows = await db.select().from(emailSuppressions).where(eq(emailSuppressions.email, email.trim().toLowerCase())).limit(1);
    const row = rows[0];
    if (!row) return null;
    return this.mapToDomain(row);
  }

  async list(limit = 50, offset = 0): Promise<{ suppressions: EmailSuppression[]; total: number }> {
    const db = getDb();
    const countRes = await db.select({ total: count() }).from(emailSuppressions);
    const rows = await db
      .select()
      .from(emailSuppressions)
      .orderBy(desc(emailSuppressions.createdAt))
      .limit(Math.min(limit, 100))
      .offset(offset);
    return {
      suppressions: rows.map((r) => this.mapToDomain(r)),
      total: Number(countRes[0]?.total || 0),
    };
  }

  async remove(email: string, reason: SuppressionReason): Promise<void> {
    const db = getDb();
    await db
      .delete(emailSuppressions)
      .where(and(eq(emailSuppressions.email, email.trim().toLowerCase()), eq(emailSuppressions.reason, reason)));
  }

  private mapToDomain(row: EmailSuppressionRow): EmailSuppression {
    return {
      id: row.id,
      memberId: row.memberId,
      email: row.email,
      reason: row.reason as SuppressionReason,
      source: row.source,
      detail: row.detail,
      createdAt: row.createdAt,
    };
  }
}
