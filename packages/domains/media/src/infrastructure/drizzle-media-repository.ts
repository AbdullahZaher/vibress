import { getDb, mediaAssets, mediaReferences, MediaAssetRow, runInTransaction } from '@vibress/database';
import { eq, and, isNull, ilike, count, desc, asc } from 'drizzle-orm';
import { MediaRepository, ListMediaFilter } from '../domain/repository';
import { AssetType, MediaAsset, MediaReference, MediaReferenceSummary } from '../domain/asset';
import crypto from 'node:crypto';

export class DrizzleMediaRepository implements MediaRepository {
  async findById(id: string): Promise<MediaAsset | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(mediaAssets)
      .where(and(eq(mediaAssets.id, id), isNull(mediaAssets.deletedAt)))
      .limit(1);

    const row = rows[0];
    if (!row) return null;
    return this.mapToDomain(row);
  }

  async findByStorageKey(storageKey: string): Promise<MediaAsset | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(mediaAssets)
      .where(and(eq(mediaAssets.storageKey, storageKey), isNull(mediaAssets.deletedAt)))
      .limit(1);

    const row = rows[0];
    if (!row) return null;
    return this.mapToDomain(row);
  }

  async create(data: Omit<MediaAsset, 'createdAt' | 'updatedAt'>): Promise<MediaAsset> {
    const db = getDb();
    const id = data.id || crypto.randomUUID();
    const now = new Date();

    const insertPayload = {
      id,
      storageProvider: data.storageProvider || 'local',
      storageKey: data.storageKey,
      originalFilename: data.originalFilename,
      displayName: data.displayName,
      mimeType: data.mimeType,
      extension: data.extension,
      sizeBytes: data.sizeBytes,
      checksum: data.checksum,
      assetType: data.assetType,
      width: data.width ?? null,
      height: data.height ?? null,
      durationMs: data.durationMs ?? null,
      metadata: data.metadata || null,
      uploadedBy: data.uploadedBy ?? null,
      createdAt: now,
      updatedAt: now,
      deletedAt: data.deletedAt ?? null,
    };

    const rows = await db.insert(mediaAssets).values(insertPayload).returning();
    const row = rows[0];
    if (!row) throw new Error('Failed to insert media asset record');
    return this.mapToDomain(row);
  }

  async update(id: string, data: { displayName?: string; metadata?: Record<string, unknown>; deletedAt?: Date | null }): Promise<MediaAsset> {
    const db = getDb();
    const now = new Date();

    const updatePayload: Record<string, unknown> = {
      updatedAt: now,
    };

    if (data.displayName !== undefined) updatePayload.displayName = data.displayName;
    if (data.metadata !== undefined) updatePayload.metadata = data.metadata;
    if (data.deletedAt !== undefined) updatePayload.deletedAt = data.deletedAt;

    const rows = await db
      .update(mediaAssets)
      .set(updatePayload)
      .where(eq(mediaAssets.id, id))
      .returning();

    const row = rows[0];
    if (!row) throw new Error(`Media asset not found for update: ${id}`);
    return this.mapToDomain(row);
  }

  async delete(id: string): Promise<void> {
    const db = getDb();
    await db.update(mediaAssets).set({ deletedAt: new Date() }).where(eq(mediaAssets.id, id));
  }

  async list(filter: ListMediaFilter = {}): Promise<{ items: MediaAsset[]; total: number }> {
    const db = getDb();
    const limit = Math.min(filter.limit || 20, 100);
    const offset = filter.offset || 0;

    const conditions = [isNull(mediaAssets.deletedAt)];

    if (filter.assetType) {
      conditions.push(eq(mediaAssets.assetType, filter.assetType));
    }
    if (filter.mimeType) {
      conditions.push(eq(mediaAssets.mimeType, filter.mimeType));
    }
    if (filter.uploadedBy) {
      conditions.push(eq(mediaAssets.uploadedBy, filter.uploadedBy));
    }
    if (filter.search && filter.search.trim()) {
      const query = `%${filter.search.trim()}%`;
      conditions.push(ilike(mediaAssets.displayName, query));
    }

    const whereClause = and(...conditions);

    const countRes = await db
      .select({ totalCount: count() })
      .from(mediaAssets)
      .where(whereClause);

    const totalCount = Number(countRes[0]?.totalCount || 0);

    let orderDirection = filter.sortOrder === 'asc' ? asc(mediaAssets.createdAt) : desc(mediaAssets.createdAt);

    if (filter.sortBy === 'updatedAt') {
      orderDirection = filter.sortOrder === 'asc' ? asc(mediaAssets.updatedAt) : desc(mediaAssets.updatedAt);
    } else if (filter.sortBy === 'displayName') {
      orderDirection = filter.sortOrder === 'asc' ? asc(mediaAssets.displayName) : desc(mediaAssets.displayName);
    } else if (filter.sortBy === 'sizeBytes') {
      orderDirection = filter.sortOrder === 'asc' ? asc(mediaAssets.sizeBytes) : desc(mediaAssets.sizeBytes);
    }

    const rows = await db
      .select()
      .from(mediaAssets)
      .where(whereClause)
      .orderBy(orderDirection)
      .limit(limit)
      .offset(offset);

    return {
      items: rows.map((r) => this.mapToDomain(r)),
      total: totalCount,
    };
  }

  async countReferences(mediaId: string): Promise<number> {
    const db = getDb();
    const res = await db
      .select({ totalCount: count() })
      .from(mediaReferences)
      .where(eq(mediaReferences.mediaId, mediaId));

    return Number(res[0]?.totalCount || 0);
  }

  async getReferences(mediaId: string): Promise<MediaReferenceSummary> {
    const db = getDb();
    const rows = await db
      .select()
      .from(mediaReferences)
      .where(eq(mediaReferences.mediaId, mediaId));

    return {
      mediaId,
      totalReferences: rows.length,
      references: rows.map((r) => ({
        resourceType: r.resourceType,
        resourceId: r.resourceId,
        fieldPath: r.fieldPath,
      })),
    };
  }

  async addReference(data: Omit<MediaReference, 'id' | 'createdAt'>): Promise<MediaReference> {
    const db = getDb();
    const id = crypto.randomUUID();
    const now = new Date();

    const insertPayload = {
      id,
      mediaId: data.mediaId,
      resourceType: data.resourceType,
      resourceId: data.resourceId,
      fieldPath: data.fieldPath || '',
      createdAt: now,
    };

    const rows = await db
      .insert(mediaReferences)
      .values(insertPayload)
      .onConflictDoNothing()
      .returning();

    const row = rows[0] || { ...insertPayload, createdAt: now };
    return {
      id: row.id,
      mediaId: row.mediaId,
      resourceType: row.resourceType,
      resourceId: row.resourceId,
      fieldPath: row.fieldPath,
      createdAt: row.createdAt,
    };
  }

  async removeReferences(mediaId: string, resourceType: string, resourceId: string): Promise<void> {
    const db = getDb();
    await db
      .delete(mediaReferences)
      .where(
        and(
          eq(mediaReferences.mediaId, mediaId),
          eq(mediaReferences.resourceType, resourceType),
          eq(mediaReferences.resourceId, resourceId)
        )
      );
  }

  async replaceResourceReferences(
    resourceType: string,
    resourceId: string,
    mediaIdsWithPaths: Array<{ mediaId: string; fieldPath?: string }>
  ): Promise<void> {
    await runInTransaction(async () => {
      const db = getDb();
      await db
        .delete(mediaReferences)
        .where(
          and(
            eq(mediaReferences.resourceType, resourceType),
            eq(mediaReferences.resourceId, resourceId)
          )
        );

      if (mediaIdsWithPaths.length > 0) {
        const now = new Date();
        const insertValues = mediaIdsWithPaths.map((item) => ({
          id: crypto.randomUUID(),
          mediaId: item.mediaId,
          resourceType,
          resourceId,
          fieldPath: item.fieldPath || '',
          createdAt: now,
        }));

        await db.insert(mediaReferences).values(insertValues).onConflictDoNothing();
      }
    });
  }

  private mapToDomain(row: MediaAssetRow): MediaAsset {
    return {
      id: row.id,
      storageProvider: row.storageProvider,
      storageKey: row.storageKey,
      originalFilename: row.originalFilename,
      displayName: row.displayName,
      mimeType: row.mimeType,
      extension: row.extension,
      sizeBytes: row.sizeBytes,
      checksum: row.checksum,
      assetType: row.assetType as AssetType,
      width: row.width,
      height: row.height,
      durationMs: row.durationMs,
      metadata: row.metadata as Record<string, unknown> | null,
      uploadedBy: row.uploadedBy,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      deletedAt: row.deletedAt,
    };
  }
}
