import { getDb, products, ProductRow } from "@vibress/database";
import { eq, and, isNull } from "drizzle-orm";
import { ProductRepository } from "../domain/repository";
import {
  Product,
  CreateProductData,
  UpdateProductData,
  ProductStatus,
} from "../domain/product";
import crypto from "node:crypto";

export class DrizzleProductRepository implements ProductRepository {
  async create(data: CreateProductData): Promise<Product> {
    const db = getDb();
    const id = data.id || crypto.randomUUID();
    const now = new Date();
    const [row] = await db
      .insert(products)
      .values({
        id,
        key: data.key,
        name: data.name,
        description: data.description || null,
        status: data.status || "active",
        visibility: data.visibility || "public",
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!row) throw new Error("Failed to insert product");
    return this.mapToDomain(row);
  }

  async findById(id: string): Promise<Product | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(products)
      .where(eq(products.id, id))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return this.mapToDomain(row);
  }

  async findByKey(key: string): Promise<Product | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(products)
      .where(eq(products.key, key))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return this.mapToDomain(row);
  }

  async update(id: string, data: UpdateProductData): Promise<Product> {
    const db = getDb();
    const updatePayload: Record<string, unknown> = { updatedAt: new Date() };
    if (data.name !== undefined) updatePayload.name = data.name;
    if (data.description !== undefined)
      updatePayload.description = data.description;
    if (data.visibility !== undefined)
      updatePayload.visibility = data.visibility;

    const [row] = await db
      .update(products)
      .set(updatePayload)
      .where(eq(products.id, id))
      .returning();
    if (!row) throw new Error(`Product not found: ${id}`);
    return this.mapToDomain(row);
  }

  async archive(id: string): Promise<Product> {
    const db = getDb();
    const [row] = await db
      .update(products)
      .set({
        status: "archived",
        archivedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(products.id, id))
      .returning();
    if (!row) throw new Error(`Product not found: ${id}`);
    return this.mapToDomain(row);
  }

  async list(filter?: {
    status?: ProductStatus;
    includeArchived?: boolean;
  }): Promise<Product[]> {
    const db = getDb();
    const conditions = [];
    if (filter?.includeArchived) {
      // no status filter
    } else if (filter?.status) {
      conditions.push(eq(products.status, filter.status));
    } else {
      conditions.push(isNull(products.archivedAt));
    }
    const whereClause = conditions.length ? and(...conditions) : undefined;
    const rows = await db
      .select()
      .from(products)
      .where(whereClause)
      .orderBy(products.createdAt);
    return rows.map((r) => this.mapToDomain(r));
  }

  private mapToDomain(row: ProductRow): Product {
    return {
      id: row.id,
      key: row.key,
      name: row.name,
      description: row.description || null,
      status: row.status as ProductStatus,
      visibility: row.visibility as Product["visibility"],
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      archivedAt: row.archivedAt,
    };
  }
}
