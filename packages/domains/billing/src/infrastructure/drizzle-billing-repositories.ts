import {
  getDb,
  billingCustomers,
  BillingCustomerRow,
  billingPlanMappings,
  BillingPlanMappingRow,
} from "@vibress/database";
import { eq, and } from "drizzle-orm";
import {
  BillingCustomerRepository,
  BillingPlanMappingRepository,
  BillingCustomer,
  CreateBillingCustomerData,
  BillingPlanMapping,
} from "../domain/mappings";
import crypto from "node:crypto";

export class DrizzleBillingCustomerRepository implements BillingCustomerRepository {
  async findOrCreate(
    data: CreateBillingCustomerData,
  ): Promise<BillingCustomer> {
    const db = getDb();
    const existing = await db
      .select()
      .from(billingCustomers)
      .where(
        and(
          eq(billingCustomers.memberId, data.memberId),
          eq(billingCustomers.provider, data.provider),
        ),
      )
      .limit(1);

    if (existing[0]) return this.mapToDomain(existing[0]);

    const [row] = await db
      .insert(billingCustomers)
      .values({
        id: crypto.randomUUID(),
        memberId: data.memberId,
        provider: data.provider,
        providerCustomerId: data.providerCustomerId,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
    if (!row) throw new Error("Failed to insert billing customer");
    return this.mapToDomain(row);
  }

  async findByMemberId(
    memberId: string,
    provider: string,
  ): Promise<BillingCustomer | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(billingCustomers)
      .where(
        and(
          eq(billingCustomers.memberId, memberId),
          eq(billingCustomers.provider, provider),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return this.mapToDomain(row);
  }

  private mapToDomain(row: BillingCustomerRow): BillingCustomer {
    return {
      id: row.id,
      memberId: row.memberId,
      provider: row.provider as BillingCustomer["provider"],
      providerCustomerId: row.providerCustomerId,
    };
  }
}

export class DrizzleBillingPlanMappingRepository implements BillingPlanMappingRepository {
  async upsert(data: {
    planId: string;
    provider: string;
    providerProductId: string;
    providerPriceId: string;
  }): Promise<BillingPlanMapping> {
    const db = getDb();
    const existing = await db
      .select()
      .from(billingPlanMappings)
      .where(
        and(
          eq(billingPlanMappings.planId, data.planId),
          eq(billingPlanMappings.provider, data.provider),
        ),
      )
      .limit(1);

    if (existing[0]) {
      const [row] = await db
        .update(billingPlanMappings)
        .set({
          providerProductId: data.providerProductId,
          providerPriceId: data.providerPriceId,
          updatedAt: new Date(),
        })
        .where(eq(billingPlanMappings.id, existing[0].id))
        .returning();
      if (!row) throw new Error("Failed to update billing plan mapping");
      return this.mapToDomain(row);
    }

    const [row] = await db
      .insert(billingPlanMappings)
      .values({
        id: crypto.randomUUID(),
        planId: data.planId,
        provider: data.provider,
        providerProductId: data.providerProductId,
        providerPriceId: data.providerPriceId,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
    if (!row) throw new Error("Failed to insert billing plan mapping");
    return this.mapToDomain(row);
  }

  async findByPlanId(
    planId: string,
    provider: string,
  ): Promise<BillingPlanMapping | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(billingPlanMappings)
      .where(
        and(
          eq(billingPlanMappings.planId, planId),
          eq(billingPlanMappings.provider, provider),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return this.mapToDomain(row);
  }

  private mapToDomain(row: BillingPlanMappingRow): BillingPlanMapping {
    return {
      id: row.id,
      planId: row.planId,
      provider: row.provider as BillingPlanMapping["provider"],
      providerProductId: row.providerProductId,
      providerPriceId: row.providerPriceId,
    };
  }
}
