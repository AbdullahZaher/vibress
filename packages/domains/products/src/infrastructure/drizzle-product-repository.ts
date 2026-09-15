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
  async create(data: CreateProductData & { publicationId?: string }): Promise<Product> {
    const db = getDb();
    const id = data.id || crypto.randomUUID();
    const now = new Date();
    const [row] = await db
      .insert(products)
      .values({
        id,
        publicationId: data.publicationId || "pub_default",
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

  async findById(id: string, publicationId?: string): Promise<Product | null> {
    const db = getDb();
    const conditions = [eq(products.id, id)];
    if (publicationId) conditions.push(eq(products.publicationId, publicationId));
    const rows = await db
      .select()
      .from(products)
      .where(and(...conditions))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return this.mapToDomain(row);
  }

  async findByKey(key: string, publicationId?: string): Promise<Product | null> {
    const db = getDb();
    const conditions = [eq(products.key, key)];
    if (publicationId) conditions.push(eq(products.publicationId, publicationId));
    const rows = await db
      .select()
      .from(products)
      .where(and(...conditions))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return this.mapToDomain(row);
  }

  async update(id: string, data: UpdateProductData, publicationId?: string): Promise<Product> {
    const db = getDb();
    const updatePayload: Record<string, unknown> = { updatedAt: new Date() };
    if (data.name !== undefined) updatePayload.name = data.name;
    if (data.description !== undefined)
      updatePayload.description = data.description;
    if (data.visibility !== undefined)
      updatePayload.visibility = data.visibility;

    const conditions = [eq(products.id, id)];
    if (publicationId) conditions.push(eq(products.publicationId, publicationId));

    const [row] = await db
      .update(products)
      .set(updatePayload)
      .where(and(...conditions))
      .returning();
    if (!row) throw new Error(`Product not found: ${id}`);
    return this.mapToDomain(row);
  }

  async archive(id: string, publicationId?: string): Promise<Product> {
    const db = getDb();
    const conditions = [eq(products.id, id)];
    if (publicationId) conditions.push(eq(products.publicationId, publicationId));

    const [row] = await db
      .update(products)
      .set({
        status: "archived",
        archivedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(...conditions))
      .returning();
    if (!row) throw new Error(`Product not found: ${id}`);
    return this.mapToDomain(row);
  }

  async list(filter?: {
    status?: ProductStatus;
    includeArchived?: boolean;
    publicationId?: string;
  }): Promise<Product[]> {
    const db = getDb();
    const conditions = [];
    if (filter?.publicationId) {
      conditions.push(eq(products.publicationId, filter.publicationId));
    }
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
      publicationId: row.publicationId,
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
