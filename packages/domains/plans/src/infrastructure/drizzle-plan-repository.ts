import { getDb, plans, PlanRow } from "@vibress/database";
import { eq, and, isNull } from "drizzle-orm";
import { PlanRepository } from "../domain/repository";
import {
  Plan,
  CreatePlanData,
  UpdatePlanData,
  PlanStatus,
} from "../domain/plan";
import crypto from "node:crypto";

export class DrizzlePlanRepository implements PlanRepository {
  async create(data: CreatePlanData & { publicationId?: string }): Promise<Plan> {
    const db = getDb();
    const id = data.id || crypto.randomUUID();
    const now = new Date();
    const [row] = await db
      .insert(plans)
      .values({
        id,
        publicationId: data.publicationId || "pub_default",
        productId: data.productId,
        key: data.key,
        name: data.name,
        description: data.description || null,
        billingType: data.billingType || "recurring",
        billingInterval: data.billingInterval || null,
        intervalCount: data.intervalCount || 1,
        currency: data.currency || "USD",
        amountMinor: data.amountMinor || 0,
        trialDays: data.trialDays || 0,
        status: data.status || "active",
        visibility: data.visibility || "public",
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!row) throw new Error("Failed to insert plan");
    return this.mapToDomain(row);
  }

  async findById(id: string, publicationId?: string): Promise<Plan | null> {
    const db = getDb();
    const conditions = [eq(plans.id, id)];
    if (publicationId) conditions.push(eq(plans.publicationId, publicationId));
    const rows = await db.select().from(plans).where(and(...conditions)).limit(1);
    const row = rows[0];
    if (!row) return null;
    return this.mapToDomain(row);
  }

  async findByKey(productId: string, key: string, publicationId?: string): Promise<Plan | null> {
    const db = getDb();
    const conditions = [eq(plans.productId, productId), eq(plans.key, key)];
    if (publicationId) conditions.push(eq(plans.publicationId, publicationId));
    const rows = await db
      .select()
      .from(plans)
      .where(and(...conditions))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return this.mapToDomain(row);
  }

  async update(id: string, data: UpdatePlanData, publicationId?: string): Promise<Plan> {
    const db = getDb();
    const updatePayload: Record<string, unknown> = { updatedAt: new Date() };
    if (data.name !== undefined) updatePayload.name = data.name;
    if (data.description !== undefined)
      updatePayload.description = data.description;
    if (data.visibility !== undefined)
      updatePayload.visibility = data.visibility;

    const conditions = [eq(plans.id, id)];
    if (publicationId) conditions.push(eq(plans.publicationId, publicationId));

    const [row] = await db
      .update(plans)
      .set(updatePayload)
      .where(and(...conditions))
      .returning();
    if (!row) throw new Error(`Plan not found: ${id}`);
    return this.mapToDomain(row);
  }

  async archive(id: string, publicationId?: string): Promise<Plan> {
    const db = getDb();
    const conditions = [eq(plans.id, id)];
    if (publicationId) conditions.push(eq(plans.publicationId, publicationId));

    const [row] = await db
      .update(plans)
      .set({
        status: "archived",
        archivedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(...conditions))
      .returning();
    if (!row) throw new Error(`Plan not found: ${id}`);
    return this.mapToDomain(row);
  }

  async listByProduct(
    productId: string,
    filter?: { status?: PlanStatus; includeArchived?: boolean },
    publicationId?: string,
  ): Promise<Plan[]> {
    const db = getDb();
    const conditions = [eq(plans.productId, productId)];
    if (publicationId) conditions.push(eq(plans.publicationId, publicationId));
    if (!filter?.includeArchived && filter?.status) {
      conditions.push(eq(plans.status, filter.status));
    } else if (!filter?.includeArchived && !filter?.status) {
      conditions.push(isNull(plans.archivedAt));
    }
    const rows = await db
      .select()
      .from(plans)
      .where(and(...conditions))
      .orderBy(plans.createdAt);
    return rows.map((r) => this.mapToDomain(r));
  }

  async listActivePublic(publicationId?: string): Promise<Plan[]> {
    const db = getDb();
    const conditions = [
      eq(plans.status, "active"),
      eq(plans.visibility, "public"),
      isNull(plans.archivedAt),
    ];
    if (publicationId) conditions.push(eq(plans.publicationId, publicationId));

    const rows = await db
      .select()
      .from(plans)
      .where(and(...conditions))
      .orderBy(plans.createdAt);
    return rows.map((r) => this.mapToDomain(r));
  }

  private mapToDomain(row: PlanRow): Plan {
    return {
      id: row.id,
      publicationId: row.publicationId,
      productId: row.productId,
      key: row.key,
      name: row.name,
      description: row.description || null,
      billingType: row.billingType as Plan["billingType"],
      billingInterval: row.billingInterval,
      intervalCount: row.intervalCount,
      currency: row.currency,
      amountMinor: row.amountMinor,
      trialDays: row.trialDays,
      status: row.status as PlanStatus,
      visibility: row.visibility as Plan["visibility"],
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      archivedAt: row.archivedAt,
    };
  }
}
