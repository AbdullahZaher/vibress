import { getDb, tags } from '@vibress/database';
import { eq, ilike } from 'drizzle-orm';
import { TagRepository } from '../domain/repository';
import { Tag, CreateTagData, UpdateTagData } from '../domain/tag';
import crypto from 'node:crypto';

export class DrizzleTagRepository implements TagRepository {
  async findById(id: string): Promise<Tag | null> {
    const db = getDb();
    const rows = await db.select().from(tags).where(eq(tags.id, id)).limit(1);
    const row = rows[0];
    if (!row) return null;
    return this.mapToDomain(row);
  }

  async findBySlug(slug: string): Promise<Tag | null> {
    const db = getDb();
    const rows = await db.select().from(tags).where(eq(tags.slug, slug)).limit(1);
    const row = rows[0];
    if (!row) return null;
    return this.mapToDomain(row);
  }

  async create(data: CreateTagData): Promise<Tag> {
    const db = getDb();
    const id = data.id || crypto.randomUUID();
    const now = new Date();

    const [row] = await db.insert(tags).values({
      id,
      name: data.name,
      slug: data.slug!,
      description: data.description || null,
      createdAt: now,
      updatedAt: now,
    }).returning();

    if (!row) throw new Error('Failed to create tag');
    return this.mapToDomain(row);
  }

  async update(id: string, data: UpdateTagData): Promise<Tag> {
    const db = getDb();
    const payload: Record<string, any> = { updatedAt: new Date() };
    if (data.name !== undefined) payload.name = data.name;
    if (data.slug !== undefined) payload.slug = data.slug;
    if (data.description !== undefined) payload.description = data.description;

    const [row] = await db.update(tags).set(payload).where(eq(tags.id, id)).returning();
    if (!row) throw new Error(`Tag not found for update: ${id}`);
    return this.mapToDomain(row);
  }

  async delete(id: string): Promise<void> {
    const db = getDb();
    await db.delete(tags).where(eq(tags.id, id));
  }

  async listAll(search?: string): Promise<Tag[]> {
    const db = getDb();
    let query = db.select().from(tags);
    if (search && search.trim()) {
      query = query.where(ilike(tags.name, `%${search.trim()}%`)) as any;
    }
    const rows = await query;
    return rows.map(r => this.mapToDomain(r));
  }

  private mapToDomain(row: typeof tags.$inferSelect): Tag {
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      description: row.description,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
