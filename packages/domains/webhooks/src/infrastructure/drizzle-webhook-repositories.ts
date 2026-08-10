import { getDb, webhookEndpoints, WebhookEndpointRow, webhookDeliveries, WebhookDeliveryRow } from '@vibress/database';
import { eq, and, count, desc, sql } from 'drizzle-orm';
import crypto from 'node:crypto';
import { WebhookRepository, WebhookEndpoint, WebhookDelivery, CreateWebhookEndpointData, ListDeliveriesFilter } from '../domain/webhook';
import { encryptSecret, decryptSecret } from '@vibress/security';

export class DrizzleWebhookRepository implements WebhookRepository {
  async createEndpoint(data: CreateWebhookEndpointData): Promise<WebhookEndpoint> {
    const db = getDb();
    const now = new Date();
    const [row] = await db
      .insert(webhookEndpoints)
      .values({
        id: data.id || crypto.randomUUID(),
        name: data.name,
        url: data.url,
        secretEncrypted: data.secret ? encryptSecret(data.secret) : null,
        enabled: data.enabled !== undefined ? data.enabled : true,
        eventTypes: data.eventTypes || [],
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!row) throw new Error('Failed to insert webhook endpoint');
    return this.mapEndpointToDomain(row);
  }

  async findEndpointById(id: string): Promise<WebhookEndpoint | null> {
    const db = getDb();
    const rows = await db.select().from(webhookEndpoints).where(eq(webhookEndpoints.id, id)).limit(1);
    const row = rows[0];
    if (!row) return null;
    return this.mapEndpointToDomain(row);
  }

  async listEndpoints(): Promise<WebhookEndpoint[]> {
    const db = getDb();
    const rows = await db.select().from(webhookEndpoints).orderBy(webhookEndpoints.createdAt);
    return rows.map((r) => this.mapEndpointToDomain(r));
  }

  async updateEndpoint(id: string, data: Partial<CreateWebhookEndpointData>): Promise<WebhookEndpoint> {
    const db = getDb();
    const payload: Record<string, unknown> = { updatedAt: new Date() };
    if (data.name !== undefined) payload.name = data.name;
    if (data.url !== undefined) payload.url = data.url;
    if (data.enabled !== undefined) payload.enabled = data.enabled;
    if (data.eventTypes !== undefined) payload.eventTypes = data.eventTypes;
    if (data.secret !== undefined) {
      // Replace-only: undefined means keep existing
      payload.secretEncrypted = data.secret === null ? null : encryptSecret(data.secret);
    }
    const [row] = await db.update(webhookEndpoints).set(payload).where(eq(webhookEndpoints.id, id)).returning();
    if (!row) throw new Error(`Webhook endpoint not found: ${id}`);
    return this.mapEndpointToDomain(row);
  }

  async deleteEndpoint(id: string): Promise<void> {
    const db = getDb();
    await db.delete(webhookEndpoints).where(eq(webhookEndpoints.id, id));
  }

  async findActiveEndpointsForEvent(eventType: string): Promise<WebhookEndpoint[]> {
    const db = getDb();
    const rows = await db
      .select()
      .from(webhookEndpoints)
      .where(eq(webhookEndpoints.enabled, true));
    return rows
      .filter((r) => (r.eventTypes as string[]).includes(eventType) || (r.eventTypes as string[]).includes('*'))
      .map((r) => this.mapEndpointToDomain(r));
  }

  async createDelivery(data: { endpointId: string; eventId: string; eventType: string; payloadHash: string }): Promise<WebhookDelivery> {
    const db = getDb();
    const now = new Date();
    const [row] = await db
      .insert(webhookDeliveries)
      .values({
        id: crypto.randomUUID(),
        endpointId: data.endpointId,
        eventId: data.eventId,
        eventType: data.eventType,
        payloadHash: data.payloadHash,
        status: 'pending',
        attemptCount: 0,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!row) throw new Error('Failed to insert webhook delivery');
    return this.mapDeliveryToDomain(row);
  }

  async findDelivery(endpointId: string, eventId: string): Promise<WebhookDelivery | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(webhookDeliveries)
      .where(and(eq(webhookDeliveries.endpointId, endpointId), eq(webhookDeliveries.eventId, eventId)))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return this.mapDeliveryToDomain(row);
  }

  async findDeliveryById(id: string): Promise<WebhookDelivery | null> {
    const db = getDb();
    const rows = await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.id, id)).limit(1);
    const row = rows[0];
    if (!row) return null;
    return this.mapDeliveryToDomain(row);
  }

  async listDeliveries(filter: ListDeliveriesFilter = {}): Promise<{ deliveries: WebhookDelivery[]; total: number }> {
    const db = getDb();
    const limit = Math.min(filter.limit || 50, 100);
    const offset = filter.offset || 0;
    const conditions = [];
    if (filter.endpointId) conditions.push(eq(webhookDeliveries.endpointId, filter.endpointId));
    if (filter.status) conditions.push(eq(webhookDeliveries.status, filter.status));
    const whereClause = conditions.length ? and(...conditions) : undefined;

    const countRes = await db.select({ total: count() }).from(webhookDeliveries).where(whereClause);
    const rows = await db.select().from(webhookDeliveries).where(whereClause).orderBy(desc(webhookDeliveries.createdAt)).limit(limit).offset(offset);
    return { deliveries: rows.map((r) => this.mapDeliveryToDomain(r)), total: Number(countRes[0]?.total || 0) };
  }

  async markDelivered(id: string, responseStatus: number): Promise<void> {
    const db = getDb();
    await db
      .update(webhookDeliveries)
      .set({ status: 'delivered', responseStatus, lastError: null, updatedAt: new Date() })
      .where(eq(webhookDeliveries.id, id));
  }

  async markFailed(id: string, error: string, attemptCount: number): Promise<void> {
    const db = getDb();
    await db
      .update(webhookDeliveries)
      .set({ status: 'failed', lastError: error.slice(0, 500), attemptCount, updatedAt: new Date() })
      .where(eq(webhookDeliveries.id, id));
  }

  async markDeadLetter(id: string, error: string): Promise<void> {
    const db = getDb();
    await db
      .update(webhookDeliveries)
      .set({ status: 'dead_letter', lastError: error.slice(0, 500), updatedAt: new Date() })
      .where(eq(webhookDeliveries.id, id));
  }

  async listPendingDeliveries(limit: number): Promise<WebhookDelivery[]> {
    const db = getDb();
    const rows = await db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.status, 'pending'))
      .orderBy(webhookDeliveries.createdAt)
      .limit(limit);
    return rows.map((r) => this.mapDeliveryToDomain(r));
  }

  async incrementAttempt(id: string): Promise<void> {
    const db = getDb();
    await db
      .update(webhookDeliveries)
      .set({ attemptCount: sql`${webhookDeliveries.attemptCount} + 1`, updatedAt: new Date() })
      .where(eq(webhookDeliveries.id, id));
  }

  private mapEndpointToDomain(row: WebhookEndpointRow): WebhookEndpoint {
    return {
      id: row.id,
      name: row.name,
      url: row.url,
      secretEncrypted: row.secretEncrypted,
      enabled: row.enabled,
      eventTypes: row.eventTypes as string[],
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private mapDeliveryToDomain(row: WebhookDeliveryRow): WebhookDelivery {
    return {
      id: row.id,
      endpointId: row.endpointId,
      eventId: row.eventId,
      eventType: row.eventType,
      payloadHash: row.payloadHash,
      status: row.status as WebhookDelivery['status'],
      attemptCount: row.attemptCount,
      lastError: row.lastError,
      responseStatus: row.responseStatus,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
