import { getDb, offers, OfferRow } from '@vibress/database';
import { eq, and, sql, lt, gt } from 'drizzle-orm';
import { OfferRepository } from '../domain/repository';
import { Offer, CreateOfferData, UpdateOfferData, OfferStatus } from '../domain/offer';
import crypto from 'node:crypto';

export class DrizzleOfferRepository implements OfferRepository {
  async create(data: CreateOfferData): Promise<Offer> {
    const db = getDb();
    const id = data.id || crypto.randomUUID();
    const now = new Date();
    const [row] = await db
      .insert(offers)
      .values({
        id,
        productId: data.productId,
        planId: data.planId || null,
        key: data.key,
        name: data.name,
        description: data.description || null,
        discountType: data.discountType,
        discountValue: data.discountValue,
        durationType: data.durationType || 'once',
        durationCycles: data.durationCycles || null,
        startsAt: data.startsAt || null,
        endsAt: data.endsAt || null,
        maxRedemptions: data.maxRedemptions || null,
        status: data.status || 'active',
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!row) throw new Error('Failed to insert offer');
    return this.mapToDomain(row);
  }

  async findById(id: string): Promise<Offer | null> {
    const db = getDb();
    const rows = await db.select().from(offers).where(eq(offers.id, id)).limit(1);
    const row = rows[0];
    if (!row) return null;
    return this.mapToDomain(row);
  }

  async findByKey(key: string): Promise<Offer | null> {
    const db = getDb();
    const rows = await db.select().from(offers).where(eq(offers.key, key)).limit(1);
    const row = rows[0];
    if (!row) return null;
    return this.mapToDomain(row);
  }

  async update(id: string, data: UpdateOfferData): Promise<Offer> {
    const db = getDb();
    const updatePayload: Record<string, unknown> = { updatedAt: new Date() };
    if (data.name !== undefined) updatePayload.name = data.name;
    if (data.description !== undefined) updatePayload.description = data.description;
    if (data.status !== undefined) updatePayload.status = data.status;
    if (data.maxRedemptions !== undefined) updatePayload.maxRedemptions = data.maxRedemptions;
    if (data.startsAt !== undefined) updatePayload.startsAt = data.startsAt;
    if (data.endsAt !== undefined) updatePayload.endsAt = data.endsAt;

    const [row] = await db.update(offers).set(updatePayload).where(eq(offers.id, id)).returning();
    if (!row) throw new Error(`Offer not found: ${id}`);
    return this.mapToDomain(row);
  }

  async list(filter?: { status?: 'active' | 'disabled' }): Promise<Offer[]> {
    const db = getDb();
    const conditions = [];
    if (filter?.status) {
      conditions.push(eq(offers.status, filter.status));
    }
    const rows = await db
      .select()
      .from(offers)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(offers.createdAt);
    return rows.map((r) => this.mapToDomain(r));
  }

  async incrementRedemption(id: string, now: Date): Promise<boolean> {
    const db = getDb();
    // Concurrency-safe: only increment if under max_redemptions
    const [row] = await db
      .update(offers)
      .set({
        redemptionCount: sql`${offers.redemptionCount} + 1`,
        updatedAt: now,
      })
      .where(
        and(
          eq(offers.id, id),
          sql`(${offers.maxRedemptions} IS NULL OR ${offers.redemptionCount} < ${offers.maxRedemptions})`
        )
      )
      .returning({ id: offers.id, redemptionCount: offers.redemptionCount });
    if (!row) return false;
    return true;
  }

  private mapToDomain(row: OfferRow): Offer {
    return {
      id: row.id,
      productId: row.productId,
      planId: row.planId || null,
      key: row.key,
      name: row.name,
      description: row.description || null,
      discountType: row.discountType as Offer['discountType'],
      discountValue: row.discountValue,
      durationType: row.durationType as Offer['durationType'],
      durationCycles: row.durationCycles,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      maxRedemptions: row.maxRedemptions,
      redemptionCount: row.redemptionCount,
      status: row.status as OfferStatus,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
