import {
  getDb,
  billingWebhookEvents,
  billingEvents,
  BillingWebhookEventRow,
  BillingEventRow,
} from "@vibress/database";
import { eq, and, desc } from "drizzle-orm";
import {
  BillingWebhookEventRepository,
  BillingEventRepository,
  BillingWebhookEvent,
  BillingEvent,
} from "../domain/webhook-events";
import crypto from "node:crypto";

export class DrizzleBillingWebhookEventRepository implements BillingWebhookEventRepository {
  async create(data: {
    id?: string | undefined;
    provider: string;
    providerEventId: string;
    eventType: string;
    payloadHash: string;
  }): Promise<BillingWebhookEvent> {
    const db = getDb();
    const [row] = await db
      .insert(billingWebhookEvents)
      .values({
        id: data.id || crypto.randomUUID(),
        provider: data.provider,
        providerEventId: data.providerEventId,
        eventType: data.eventType,
        payloadHash: data.payloadHash,
        status: "received",
        attemptCount: 0,
        receivedAt: new Date(),
      })
      .returning();
    if (!row) throw new Error("Failed to insert webhook event");
    return this.mapToDomain(row);
  }

  async findByProviderEventId(
    provider: string,
    providerEventId: string,
  ): Promise<BillingWebhookEvent | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(billingWebhookEvents)
      .where(
        and(
          eq(billingWebhookEvents.provider, provider),
          eq(billingWebhookEvents.providerEventId, providerEventId),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return this.mapToDomain(row);
  }

  async markProcessed(id: string, processedAt = new Date()): Promise<void> {
    const db = getDb();
    await db
      .update(billingWebhookEvents)
      .set({ status: "processed", processedAt })
      .where(eq(billingWebhookEvents.id, id));
  }

  async markFailed(
    id: string,
    error: string,
    attemptCount?: number,
  ): Promise<void> {
    const db = getDb();
    const updatePayload: Record<string, unknown> = {
      status: "failed",
      lastError: error.slice(0, 500),
    };
    if (attemptCount !== undefined) updatePayload.attemptCount = attemptCount;
    await db
      .update(billingWebhookEvents)
      .set(updatePayload)
      .where(eq(billingWebhookEvents.id, id));
  }

  async listPending(limit = 50): Promise<BillingWebhookEvent[]> {
    const db = getDb();
    const rows = await db
      .select()
      .from(billingWebhookEvents)
      .where(eq(billingWebhookEvents.status, "received"))
      .orderBy(billingWebhookEvents.receivedAt)
      .limit(limit);
    return rows.map((r) => this.mapToDomain(r));
  }

  private mapToDomain(row: BillingWebhookEventRow): BillingWebhookEvent {
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

export class DrizzleBillingEventRepository implements BillingEventRepository {
  async record(data: {
    subscriptionId?: string | null | undefined;
    memberId?: string | null | undefined;
    provider?: string | null | undefined;
    providerEventId?: string | null | undefined;
    type: string;
    data?: Record<string, unknown> | null | undefined;
  }): Promise<BillingEvent> {
    const db = getDb();
    const [row] = await db
      .insert(billingEvents)
      .values({
        id: crypto.randomUUID(),
        subscriptionId: data.subscriptionId || null,
        memberId: data.memberId || null,
        provider: data.provider || null,
        providerEventId: data.providerEventId || null,
        type: data.type,
        occurredAt: new Date(),
        data: data.data || null,
        createdAt: new Date(),
      })
      .returning();
    if (!row) throw new Error("Failed to record billing event");
    return this.mapToDomain(row);
  }

  async listForSubscription(
    subscriptionId: string,
    limit = 50,
  ): Promise<BillingEvent[]> {
    const db = getDb();
    const rows = await db
      .select()
      .from(billingEvents)
      .where(eq(billingEvents.subscriptionId, subscriptionId))
      .orderBy(desc(billingEvents.occurredAt))
      .limit(limit);
    return rows.map((r) => this.mapToDomain(r));
  }

  private mapToDomain(row: BillingEventRow): BillingEvent {
    return {
      id: row.id,
      subscriptionId: row.subscriptionId,
      memberId: row.memberId,
      provider: row.provider,
      providerEventId: row.providerEventId,
      type: row.type,
      occurredAt: row.occurredAt,
      data: row.data as Record<string, unknown> | null,
    };
  }
}
