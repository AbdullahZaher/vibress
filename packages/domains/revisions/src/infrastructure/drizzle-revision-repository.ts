import { getDb, revisions } from "@vibress/database";
import { eq, and, desc, max } from "drizzle-orm";
import { RevisionRepository } from "../domain/repository";
import {
  Revision,
  CreateRevisionData,
  RevisionResourceType,
} from "../domain/revision";
import crypto from "node:crypto";

export class DrizzleRevisionRepository implements RevisionRepository {
  async getNextRevisionNumber(
    resourceType: RevisionResourceType,
    resourceId: string,
  ): Promise<number> {
    const db = getDb();
    const result = await db
      .select({ maxNum: max(revisions.revisionNumber) })
      .from(revisions)
      .where(
        and(
          eq(revisions.resourceType, resourceType),
          eq(revisions.resourceId, resourceId),
        ),
      );

    const highest = result[0]?.maxNum;
    return (highest || 0) + 1;
  }

  async createRevision(data: CreateRevisionData): Promise<Revision> {
    const db = getDb();
    const id = data.id || crypto.randomUUID();
    const revisionNumber = await this.getNextRevisionNumber(
      data.resourceType,
      data.resourceId,
    );
    const now = new Date();

    const [row] = await db
      .insert(revisions)
      .values({
        id,
        resourceType: data.resourceType,
        resourceId: data.resourceId,
        revisionNumber,
        title: data.title,
        slug: data.slug,
        excerpt: data.excerpt || null,
        content: data.content,
        contentVersion: data.contentVersion || 1,
        createdBy: data.createdBy,
        metadata: data.metadata || null,
        createdAt: now,
      })
      .returning();

    if (!row) throw new Error("Failed to insert revision");
    return this.mapToDomain(row);
  }

  async getRevisions(
    resourceType: RevisionResourceType,
    resourceId: string,
  ): Promise<Revision[]> {
    const db = getDb();
    const rows = await db
      .select()
      .from(revisions)
      .where(
        and(
          eq(revisions.resourceType, resourceType),
          eq(revisions.resourceId, resourceId),
        ),
      )
      .orderBy(desc(revisions.revisionNumber));

    return rows.map((r) => this.mapToDomain(r));
  }

  async getRevisionById(id: string): Promise<Revision | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(revisions)
      .where(eq(revisions.id, id))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return this.mapToDomain(row);
  }

  private mapToDomain(row: typeof revisions.$inferSelect): Revision {
    return {
      id: row.id,
      resourceType: row.resourceType as RevisionResourceType,
      resourceId: row.resourceId,
      revisionNumber: row.revisionNumber,
      title: row.title,
      slug: row.slug,
      excerpt: row.excerpt,
      content: row.content as Record<string, unknown>,
      contentVersion: row.contentVersion,
      createdBy: row.createdBy,
      metadata: row.metadata as Record<string, unknown> | null,
      createdAt: row.createdAt,
    };
  }
}
