import { getDb, tags } from "@vibress/database";
import { eq, and, ilike } from "drizzle-orm";
import { TagRepository } from "../domain/repository";
import { Tag, CreateTagData, UpdateTagData } from "../domain/tag";
import crypto from "node:crypto";

export class DrizzleTagRepository implements TagRepository {
  async findById(id: string, publicationId?: string): Promise<Tag | null> {
    const db = getDb();
    const conditions = [eq(tags.id, id)];
    if (publicationId) conditions.push(eq(tags.publicationId, publicationId));
    const rows = await db.select().from(tags).where(and(...conditions)).limit(1);
    const row = rows[0];
    if (!row) return null;
    return this.mapToDomain(row);
  }

  async findBySlug(slug: string, publicationId?: string): Promise<Tag | null> {
    const db = getDb();
    const conditions = [eq(tags.slug, slug)];
    if (publicationId) conditions.push(eq(tags.publicationId, publicationId));
    const rows = await db
      .select()
      .from(tags)
      .where(and(...conditions))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return this.mapToDomain(row);
  }

  async create(data: CreateTagData & { publicationId?: string }): Promise<Tag> {
    const db = getDb();
    const id = data.id || crypto.randomUUID();
    const now = new Date();

    const [row] = await db
      .insert(tags)
      .values({
        id,
        publicationId: data.publicationId || "pub_default",
        name: data.name,
        slug: data.slug!,
        description: data.description || null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    if (!row) throw new Error("Failed to create tag");
    return this.mapToDomain(row);
  }

  async update(id: string, data: UpdateTagData, publicationId?: string): Promise<Tag> {
    const db = getDb();
    const payload: Record<string, unknown> = { updatedAt: new Date() };
    if (data.name !== undefined) payload.name = data.name;
    if (data.slug !== undefined) payload.slug = data.slug;
    if (data.description !== undefined) payload.description = data.description;

    const conditions = [eq(tags.id, id)];
    if (publicationId) conditions.push(eq(tags.publicationId, publicationId));

    const [row] = await db
      .update(tags)
      .set(payload)
      .where(and(...conditions))
      .returning();
    if (!row) throw new Error(`Tag not found for update: ${id}`);
    return this.mapToDomain(row);
  }

  async delete(id: string, publicationId?: string): Promise<void> {
    const db = getDb();
    const conditions = [eq(tags.id, id)];
    if (publicationId) conditions.push(eq(tags.publicationId, publicationId));
    await db.delete(tags).where(and(...conditions));
  }

  async listAll(search?: string, publicationId?: string): Promise<Tag[]> {
    const db = getDb();
    const conditions = [];
    if (publicationId) conditions.push(eq(tags.publicationId, publicationId));
    if (search && search.trim()) {
      conditions.push(ilike(tags.name, `%${search.trim()}%`));
    }
    const base = db.select().from(tags);
    const rows = conditions.length > 0 ? await base.where(and(...conditions)) : await base;
    return rows.map((r) => this.mapToDomain(r));
  }

  private mapToDomain(row: typeof tags.$inferSelect): Tag {
    return {
      id: row.id,
      publicationId: row.publicationId,
      name: row.name,
      slug: row.slug,
      description: row.description,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
