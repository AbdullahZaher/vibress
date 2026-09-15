import { getDb, searchDocuments } from "@vibress/database";
import { eq, and, count, desc, sql } from "drizzle-orm";
import crypto from "node:crypto";
import {
  SearchRepository,
  SearchResult,
  SearchDocumentInput,
} from "../domain/search";

export class DrizzleSearchRepository implements SearchRepository {
  async upsert(doc: SearchDocumentInput & { publicationId?: string }): Promise<void> {
    const db = getDb();
    const pubId = doc.publicationId || "pub_default";
    await db
      .insert(searchDocuments)
      .values({
        id: crypto.randomUUID(),
        publicationId: pubId,
        entityType: doc.entityType,
        entityId: doc.entityId,
        title: doc.title,
        bodyText: doc.bodyText || "",
        slug: doc.slug || "",
        url: doc.url || "",
        searchable: true,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [searchDocuments.publicationId, searchDocuments.entityType, searchDocuments.entityId],
        set: {
          title: doc.title,
          bodyText: doc.bodyText || "",
          slug: doc.slug || "",
          url: doc.url || "",
          searchable: true,
          updatedAt: new Date(),
        },
      });
  }

  async remove(entityType: string, entityId: string, publicationId?: string): Promise<void> {
    const db = getDb();
    const conditions = [
      eq(searchDocuments.entityType, entityType),
      eq(searchDocuments.entityId, entityId),
    ];
    if (publicationId) conditions.push(eq(searchDocuments.publicationId, publicationId));
    await db
      .delete(searchDocuments)
      .where(and(...conditions));
  }

  async setSearchable(
    entityType: string,
    entityId: string,
    searchable: boolean,
    publicationId?: string,
  ): Promise<void> {
    const db = getDb();
    const conditions = [
      eq(searchDocuments.entityType, entityType),
      eq(searchDocuments.entityId, entityId),
    ];
    if (publicationId) conditions.push(eq(searchDocuments.publicationId, publicationId));
    await db
      .update(searchDocuments)
      .set({ searchable, updatedAt: new Date() })
      .where(and(...conditions));
  }

  async query(
    q: string,
    limit: number,
    offset: number,
    publicationId?: string,
  ): Promise<{ results: SearchResult[]; total: number }> {
    const db = getDb();
    const like = `%${q}%`;

    const whereConditions = [
      eq(searchDocuments.searchable, true),
      sql`(${searchDocuments.title} ILIKE ${like} OR ${searchDocuments.bodyText} ILIKE ${like} OR ${searchDocuments.slug} ILIKE ${like})`,
    ];
    if (publicationId) {
      whereConditions.push(eq(searchDocuments.publicationId, publicationId));
    }

    const whereClause = and(...whereConditions);

    const countRes = await db
      .select({ total: count() })
      .from(searchDocuments)
      .where(whereClause);

    const rows = await db
      .select()
      .from(searchDocuments)
      .where(whereClause)
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

  async count(publicationId?: string): Promise<number> {
    const db = getDb();
    const base = db.select({ total: count() }).from(searchDocuments);
    const rows = publicationId ? await base.where(eq(searchDocuments.publicationId, publicationId)) : await base;
    return Number(rows[0]?.total || 0);
  }

  async clear(publicationId?: string): Promise<void> {
    const db = getDb();
    if (publicationId) {
      await db.delete(searchDocuments).where(eq(searchDocuments.publicationId, publicationId));
    } else {
      await db.delete(searchDocuments);
    }
  }
}
