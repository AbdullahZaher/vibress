import { getDb, subscriptions, SubscriptionRow } from "@vibress/database";
import { eq, and, inArray, count, desc } from "drizzle-orm";
import { SubscriptionRepository } from "../domain/repository";
import {
  Subscription,
  CreateSubscriptionData,
  UpdateSubscriptionData,
  ListSubscriptionsFilter,
  SubscriptionStatus,
  ACCESS_GRANTING_STATUSES,
} from "../domain/subscription";
import crypto from "node:crypto";

export class DrizzleSubscriptionRepository implements SubscriptionRepository {
  async create(data: CreateSubscriptionData): Promise<Subscription> {
    const db = getDb();
    const id = data.id || crypto.randomUUID();
    const now = new Date();
    const [row] = await db
      .insert(subscriptions)
      .values({
        id,
        memberId: data.memberId,
        productId: data.productId,
        planId: data.planId,
        provider: data.provider || null,
        providerSubscriptionId: data.providerSubscriptionId || null,
        providerCustomerId: data.providerCustomerId || null,
        status: data.status,
        currency: data.currency,
        amountMinor: data.amountMinor,
        billingInterval: data.billingInterval,
        intervalCount: data.intervalCount || 1,
        currentPeriodStart: data.currentPeriodStart || null,
        currentPeriodEnd: data.currentPeriodEnd || null,
        trialStart: data.trialStart || null,
        trialEnd: data.trialEnd || null,
        cancelAtPeriodEnd: data.cancelAtPeriodEnd || false,
        offerId: data.offerId || null,
        providerEventTimestamp: data.providerEventTimestamp || null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!row) throw new Error("Failed to insert subscription");
    return this.mapToDomain(row);
  }

  async findById(id: string): Promise<Subscription | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.id, id))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return this.mapToDomain(row);
  }

  async findByProviderSubscriptionId(
    provider: string,
    providerSubscriptionId: string,
  ): Promise<Subscription | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.provider, provider),
          eq(subscriptions.providerSubscriptionId, providerSubscriptionId),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return this.mapToDomain(row);
  }

  async update(
    id: string,
    data: UpdateSubscriptionData,
  ): Promise<Subscription> {
    const db = getDb();
    const updatePayload: Record<string, unknown> = { updatedAt: new Date() };
    if (data.status !== undefined) updatePayload.status = data.status;
    if (data.providerSubscriptionId !== undefined)
      updatePayload.providerSubscriptionId = data.providerSubscriptionId;
    if (data.providerCustomerId !== undefined)
      updatePayload.providerCustomerId = data.providerCustomerId;
    if (data.currentPeriodStart !== undefined)
      updatePayload.currentPeriodStart = data.currentPeriodStart;
    if (data.currentPeriodEnd !== undefined)
      updatePayload.currentPeriodEnd = data.currentPeriodEnd;
    if (data.trialStart !== undefined)
      updatePayload.trialStart = data.trialStart;
    if (data.trialEnd !== undefined) updatePayload.trialEnd = data.trialEnd;
    if (data.cancelAtPeriodEnd !== undefined)
      updatePayload.cancelAtPeriodEnd = data.cancelAtPeriodEnd;
    if (data.cancelledAt !== undefined)
      updatePayload.cancelledAt = data.cancelledAt;
    if (data.endedAt !== undefined) updatePayload.endedAt = data.endedAt;
    if (data.providerEventTimestamp !== undefined)
      updatePayload.providerEventTimestamp = data.providerEventTimestamp;

    const [row] = await db
      .update(subscriptions)
      .set(updatePayload)
      .where(eq(subscriptions.id, id))
      .returning();
    if (!row) throw new Error(`Subscription not found: ${id}`);
    return this.mapToDomain(row);
  }

  async list(
    filter: ListSubscriptionsFilter = {},
  ): Promise<{ subscriptions: Subscription[]; total: number }> {
    const db = getDb();
    const limit = Math.min(filter.limit || 20, 100);
    const offset = filter.offset || 0;

    const conditions = [];
    if (filter.memberId)
      conditions.push(eq(subscriptions.memberId, filter.memberId));
    if (filter.status) conditions.push(eq(subscriptions.status, filter.status));
    if (filter.productId)
      conditions.push(eq(subscriptions.productId, filter.productId));
    if (filter.planId) conditions.push(eq(subscriptions.planId, filter.planId));

    const whereClause = conditions.length ? and(...conditions) : undefined;

    const countRes = await db
      .select({ totalCount: count() })
      .from(subscriptions)
      .where(whereClause);

    const rows = await db
      .select()
      .from(subscriptions)
      .where(whereClause)
      .orderBy(desc(subscriptions.createdAt))
      .limit(limit)
      .offset(offset);

    return {
      subscriptions: rows.map((r) => this.mapToDomain(r)),
      total: Number(countRes[0]?.totalCount || 0),
    };
  }

  async findActiveForMember(
    memberId: string,
    productId: string,
  ): Promise<Subscription | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.memberId, memberId),
          eq(subscriptions.productId, productId),
          inArray(subscriptions.status, [
            "trialing",
            "active",
            "past_due",
            "unpaid",
          ]),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return this.mapToDomain(row);
  }

  async hasActiveForMember(memberId: string): Promise<boolean> {
    const db = getDb();
    const rows = await db
      .select({ id: subscriptions.id })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.memberId, memberId),
          inArray(subscriptions.status, ACCESS_GRANTING_STATUSES),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  private mapToDomain(row: SubscriptionRow): Subscription {
    return {
      id: row.id,
      memberId: row.memberId,
      productId: row.productId,
      planId: row.planId,
      provider: row.provider || null,
      providerSubscriptionId: row.providerSubscriptionId || null,
      providerCustomerId: row.providerCustomerId || null,
      status: row.status as SubscriptionStatus,
      currency: row.currency,
      amountMinor: row.amountMinor,
      billingInterval: row.billingInterval,
      intervalCount: row.intervalCount,
      currentPeriodStart: row.currentPeriodStart,
      currentPeriodEnd: row.currentPeriodEnd,
      trialStart: row.trialStart,
      trialEnd: row.trialEnd,
      cancelAtPeriodEnd: row.cancelAtPeriodEnd,
      cancelledAt: row.cancelledAt,
      endedAt: row.endedAt,
      offerId: row.offerId,
      providerEventTimestamp: row.providerEventTimestamp,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
