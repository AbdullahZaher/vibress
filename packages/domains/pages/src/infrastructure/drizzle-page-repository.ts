import { getDb, pages } from '@vibress/database';
import { eq, and, isNull, ilike, count, lte, desc } from 'drizzle-orm';
import { PageRepository } from '../domain/repository';
import { Page, CreatePageData, ListPagesFilter, PageStatus, PageVisibility, PageDomainError } from '../domain/page';
import crypto from 'node:crypto';

export class DrizzlePageRepository implements PageRepository {
  async findById(id: string): Promise<Page | null> {
    const db = getDb();
    const rows = await db.select().from(pages).where(and(eq(pages.id, id), isNull(pages.deletedAt))).limit(1);
    const row = rows[0];
    if (!row) return null;
    return this.mapToDomain(row);
  }

  async findBySlug(slug: string): Promise<Page | null> {
    const db = getDb();
    const rows = await db.select().from(pages).where(and(eq(pages.slug, slug), isNull(pages.deletedAt))).limit(1);
    const row = rows[0];
    if (!row) return null;
    return this.mapToDomain(row);
  }

  async findPublishedBySlug(slug: string): Promise<Page | null> {
    const db = getDb();
    const now = new Date();
    const rows = await db
      .select()
      .from(pages)
      .where(
        and(
          eq(pages.slug, slug),
          eq(pages.status, 'published'),
          eq(pages.visibility, 'public'),
          lte(pages.publishedAt, now),
          isNull(pages.deletedAt)
        )
      )
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return this.mapToDomain(row);
  }

  async create(data: CreatePageData & { slug: string; content: Record<string, unknown> }): Promise<Page> {
    const db = getDb();
    const id = data.id || crypto.randomUUID();
    const now = new Date();

    const insertPayload = {
      id,
      title: data.title,
      slug: data.slug,
      excerpt: data.excerpt || null,
      content: data.content,
      contentVersion: data.contentVersion || 1,
      status: data.status || 'draft',
      visibility: data.visibility || 'public',
      version: 1,
      primaryAuthorId: data.primaryAuthorId,
      createdBy: data.createdBy || data.primaryAuthorId,
      updatedBy: data.createdBy || data.primaryAuthorId,
      publishedBy: null,
      publishedAt: null,
      scheduledAt: data.scheduledAt || null,
      metaTitle: data.metaTitle || null,
      metaDescription: data.metaDescription || null,
      canonicalUrl: data.canonicalUrl || null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };

    const rows = await db.insert(pages).values(insertPayload).returning();
    const row = rows[0];
    if (!row) throw new Error('Failed to insert page');
    return this.mapToDomain(row);
  }

  async update(id: string, data: Partial<Page> & { version: number }): Promise<Page> {
    const db = getDb();
    const current = await this.findById(id);
    if (!current) throw new Error(`Page not found: ${id}`);

    if (current.version !== data.version) {
      throw new PageDomainError('CONTENT_CONFLICT', 'Content has been modified by another request');
    }

    const nextVersion = current.version + 1;
    const now = new Date();

    const updatePayload: Record<string, unknown> = {
      version: nextVersion,
      updatedAt: now,
    };

    if (data.title !== undefined) updatePayload.title = data.title;
    if (data.slug !== undefined) updatePayload.slug = data.slug;
    if (data.excerpt !== undefined) updatePayload.excerpt = data.excerpt;
    if (data.content !== undefined) updatePayload.content = data.content;
    if (data.contentVersion !== undefined) updatePayload.contentVersion = data.contentVersion;
    if (data.status !== undefined) updatePayload.status = data.status;
    if (data.visibility !== undefined) updatePayload.visibility = data.visibility;
    if (data.primaryAuthorId !== undefined) updatePayload.primaryAuthorId = data.primaryAuthorId;
    if (data.updatedBy !== undefined) updatePayload.updatedBy = data.updatedBy;
    if (data.publishedBy !== undefined) updatePayload.publishedBy = data.publishedBy;
    if (data.publishedAt !== undefined) updatePayload.publishedAt = data.publishedAt;
    if (data.scheduledAt !== undefined) updatePayload.scheduledAt = data.scheduledAt;
    if (data.metaTitle !== undefined) updatePayload.metaTitle = data.metaTitle;
    if (data.metaDescription !== undefined) updatePayload.metaDescription = data.metaDescription;
    if (data.canonicalUrl !== undefined) updatePayload.canonicalUrl = data.canonicalUrl;
    if (data.deletedAt !== undefined) updatePayload.deletedAt = data.deletedAt;

    const [row] = await db.update(pages).set(updatePayload).where(and(eq(pages.id, id), eq(pages.version, current.version))).returning();
    if (!row) {
      throw new PageDomainError('CONTENT_CONFLICT', 'Content has been modified by another request');
    }
    return this.mapToDomain(row);
  }

  async delete(id: string): Promise<void> {
    const db = getDb();
    await db.update(pages).set({ deletedAt: new Date() }).where(eq(pages.id, id));
  }

  async list(filter: ListPagesFilter = {}): Promise<{ pages: Page[]; total: number }> {
    const db = getDb();
    const limit = Math.min(filter.limit || 20, 100);
    const offset = filter.offset || 0;

    const conditions = [isNull(pages.deletedAt)];
    if (filter.publishedOnly) {
      conditions.push(eq(pages.status, 'published'));
      conditions.push(lte(pages.publishedAt, new Date()));
    } else if (filter.status) {
      conditions.push(eq(pages.status, filter.status));
    }
    if (filter.visibility) {
      conditions.push(eq(pages.visibility, filter.visibility));
    }
    if (filter.search && filter.search.trim()) {
      conditions.push(ilike(pages.title, `%${filter.search.trim()}%`));
    }

    const whereClause = and(...conditions);

    const countRes = await db
      .select({ totalCount: count() })
      .from(pages)
      .where(whereClause);

    const totalCount = countRes[0]?.totalCount || 0;

    const rows = await db
      .select()
      .from(pages)
      .where(whereClause)
      .orderBy(desc(pages.createdAt))
      .limit(limit)
      .offset(offset);

    return {
      pages: rows.map(r => this.mapToDomain(r)),
      total: Number(totalCount),
    };
  }

  async findDueScheduledPages(now = new Date()): Promise<Page[]> {
    const db = getDb();
    const rows = await db
      .select()
      .from(pages)
      .where(
        and(
          eq(pages.status, 'scheduled'),
          lte(pages.scheduledAt, now),
          isNull(pages.deletedAt)
        )
      );

    return rows.map(r => this.mapToDomain(r));
  }

  private mapToDomain(row: typeof pages.$inferSelect): Page {
    return {
      id: row.id,
      title: row.title,
      slug: row.slug,
      excerpt: row.excerpt,
      content: row.content as Record<string, unknown>,
      contentVersion: row.contentVersion,
      status: row.status as PageStatus,
      visibility: row.visibility as PageVisibility,
      version: row.version,
      primaryAuthorId: row.primaryAuthorId,
      createdBy: row.createdBy,
      updatedBy: row.updatedBy,
      publishedBy: row.publishedBy,
      publishedAt: row.publishedAt,
      scheduledAt: row.scheduledAt,
      metaTitle: row.metaTitle || null,
      metaDescription: row.metaDescription || null,
      canonicalUrl: row.canonicalUrl || null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      deletedAt: row.deletedAt,
    };
  }
}
