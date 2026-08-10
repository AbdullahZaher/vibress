import { getDb, searchDocuments } from '@vibress/database';
import { eq, and, count, desc, sql } from 'drizzle-orm';
import crypto from 'node:crypto';
import { SearchRepository, SearchResult, SearchDocumentInput } from '../domain/search';

export class DrizzleSearchRepository implements SearchRepository {
  async upsert(doc: SearchDocumentInput): Promise<void> {
    const db = getDb();
    await db
      .insert(searchDocuments)
      .values({
        id: crypto.randomUUID(),
        entityType: doc.entityType,
        entityId: doc.entityId,
        title: doc.title,
        bodyText: doc.bodyText || '',
        slug: doc.slug || '',
        url: doc.url || '',
        searchable: true,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [searchDocuments.entityType, searchDocuments.entityId],
        set: {
          title: doc.title,
          bodyText: doc.bodyText || '',
          slug: doc.slug || '',
          url: doc.url || '',
          searchable: true,
          updatedAt: new Date(),
        },
      });
  }

  async remove(entityType: string, entityId: string): Promise<void> {
    const db = getDb();
    await db
      .delete(searchDocuments)
      .where(and(eq(searchDocuments.entityType, entityType), eq(searchDocuments.entityId, entityId)));
  }

  async setSearchable(entityType: string, entityId: string, searchable: boolean): Promise<void> {
    const db = getDb();
    await db
      .update(searchDocuments)
      .set({ searchable, updatedAt: new Date() })
      .where(and(eq(searchDocuments.entityType, entityType), eq(searchDocuments.entityId, entityId)));
  }

  async query(q: string, limit: number, offset: number): Promise<{ results: SearchResult[]; total: number }> {
    const db = getDb();
    const like = `%${q}%`;

    // Trigram similarity ranking: exact/prefix matches rank higher than fuzzy
    const countRes = await db
      .select({ total: count() })
      .from(searchDocuments)
      .where(and(
        eq(searchDocuments.searchable, true),
        sql`(${searchDocuments.title} ILIKE ${like} OR ${searchDocuments.bodyText} ILIKE ${like} OR ${searchDocuments.slug} ILIKE ${like})`,
      ));

    const rows = await db
      .select()
      .from(searchDocuments)
      .where(and(
        eq(searchDocuments.searchable, true),
        sql`(${searchDocuments.title} ILIKE ${like} OR ${searchDocuments.bodyText} ILIKE ${like} OR ${searchDocuments.slug} ILIKE ${like})`,
      ))
      .orderBy(
        sql`CASE WHEN ${searchDocuments.title} ILIKE ${like} THEN 0 WHEN ${searchDocuments.slug} ILIKE ${like} THEN 1 ELSE 2 END`,
        sql`similarity(${searchDocuments.title}, ${q}) DESC`,
        desc(searchDocuments.updatedAt),
      )
      .limit(Math.min(limit, 50))
      .offset(offset);

    const results: SearchResult[] = rows.map((r) => ({
      id: r.id,
      entityType: r.entityType,
      entityId: r.entityId,
      title: r.title,
      excerpt: r.bodyText.slice(0, 200),
      url: r.url,
    }));

    return { results, total: Number(countRes[0]?.total || 0) };
  }

  async count(): Promise<number> {
    const db = getDb();
    const rows = await db.select({ total: count() }).from(searchDocuments);
    return Number(rows[0]?.total || 0);
  }

  async clear(): Promise<void> {
    const db = getDb();
    await db.delete(searchDocuments);
  }
}
