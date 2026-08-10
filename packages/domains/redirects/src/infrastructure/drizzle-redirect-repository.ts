import { getDb, redirects, RedirectRow } from '@vibress/database';
import { eq, and } from 'drizzle-orm';
import crypto from 'node:crypto';
import { RedirectRepository, Redirect, CreateRedirectData } from '../domain/redirect';

export class DrizzleRedirectRepository implements RedirectRepository {
  async create(data: CreateRedirectData): Promise<Redirect> {
    const db = getDb();
    const now = new Date();
    const [row] = await db.insert(redirects).values({
      id: data.id || crypto.randomUUID(),
      source: data.source,
      destination: data.destination,
      statusCode: data.statusCode || 301,
      enabled: data.enabled !== undefined ? data.enabled : true,
      sortOrder: data.sortOrder || 0,
      createdAt: now,
      updatedAt: now,
    }).returning();
    if (!row) throw new Error('Failed to insert redirect');
    return this.mapToDomain(row);
  }

  async findById(id: string): Promise<Redirect | null> {
    const db = getDb();
    const rows = await db.select().from(redirects).where(eq(redirects.id, id)).limit(1);
    const row = rows[0];
    if (!row) return null;
    return this.mapToDomain(row);
  }

  async findBySource(source: string): Promise<Redirect | null> {
    const db = getDb();
    const rows = await db.select().from(redirects).where(eq(redirects.source, source)).limit(1);
    const row = rows[0];
    if (!row) return null;
    return this.mapToDomain(row);
  }

  async update(id: string, data: Partial<CreateRedirectData>): Promise<Redirect> {
    const db = getDb();
    const payload: Record<string, unknown> = { updatedAt: new Date() };
    if (data.source !== undefined) payload.source = data.source;
    if (data.destination !== undefined) payload.destination = data.destination;
    if (data.statusCode !== undefined) payload.statusCode = data.statusCode;
    if (data.enabled !== undefined) payload.enabled = data.enabled;
    if (data.sortOrder !== undefined) payload.sortOrder = data.sortOrder;
    const [row] = await db.update(redirects).set(payload).where(eq(redirects.id, id)).returning();
    if (!row) throw new Error(`Redirect not found: ${id}`);
    return this.mapToDomain(row);
  }

  async delete(id: string): Promise<void> {
    const db = getDb();
    await db.delete(redirects).where(eq(redirects.id, id));
  }

  async list(): Promise<Redirect[]> {
    const db = getDb();
    const rows = await db.select().from(redirects).orderBy(redirects.sortOrder, redirects.source);
    return rows.map((r) => this.mapToDomain(r));
  }

  async listEnabled(): Promise<Redirect[]> {
    const db = getDb();
    const rows = await db.select().from(redirects).where(eq(redirects.enabled, true)).orderBy(redirects.sortOrder, redirects.source);
    return rows.map((r) => this.mapToDomain(r));
  }

  private mapToDomain(row: RedirectRow): Redirect {
    return {
      id: row.id,
      source: row.source,
      destination: row.destination,
      statusCode: row.statusCode,
      enabled: row.enabled,
      sortOrder: row.sortOrder,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
