import { getDb, importExportJobs, ImportExportJobRow } from '@vibress/database';
import { eq, and, count, desc } from 'drizzle-orm';
import crypto from 'node:crypto';
import { JobRepository, ImportExportJob, ImportExportJobType, ImportExportJobStatus } from '../domain/job';

export class DrizzleImportExportJobRepository implements JobRepository {
  async create(data: { type: ImportExportJobType; requestedBy: string | null }): Promise<ImportExportJob> {
    const db = getDb();
    const [row] = await db.insert(importExportJobs).values({
      id: crypto.randomUUID(),
      type: data.type,
      status: 'pending',
      requestedBy: data.requestedBy,
      progress: 0,
      createdAt: new Date(),
    }).returning();
    if (!row) throw new Error('Failed to insert job');
    return this.mapToDomain(row);
  }

  async findById(id: string): Promise<ImportExportJob | null> {
    const db = getDb();
    const rows = await db.select().from(importExportJobs).where(eq(importExportJobs.id, id)).limit(1);
    const row = rows[0];
    if (!row) return null;
    return this.mapToDomain(row);
  }

  async list(filter: { type?: string; status?: string; limit?: number; offset?: number } = {}): Promise<{ jobs: ImportExportJob[]; total: number }> {
    const db = getDb();
    const limit = Math.min(filter.limit || 20, 100);
    const offset = filter.offset || 0;
    const conditions = [];
    if (filter.type) conditions.push(eq(importExportJobs.type, filter.type));
    if (filter.status) conditions.push(eq(importExportJobs.status, filter.status));
    const whereClause = conditions.length ? and(...conditions) : undefined;

    const countRes = await db.select({ total: count() }).from(importExportJobs).where(whereClause);
    const rows = await db.select().from(importExportJobs).where(whereClause).orderBy(desc(importExportJobs.createdAt)).limit(limit).offset(offset);
    return { jobs: rows.map((r) => this.mapToDomain(r)), total: Number(countRes[0]?.total || 0) };
  }

  async updateStatus(id: string, status: ImportExportJobStatus, patch?: Partial<ImportExportJob>): Promise<void> {
    const db = getDb();
    const payload: Record<string, unknown> = { status };
    if (patch?.progress !== undefined) payload.progress = patch.progress;
    if (patch?.errorSummary !== undefined) payload.errorSummary = patch.errorSummary;
    if (patch?.artifactKey !== undefined) payload.artifactKey = patch.artifactKey;
    if (patch?.artifactExpiresAt !== undefined) payload.artifactExpiresAt = patch.artifactExpiresAt;
    if (patch?.summary !== undefined) payload.summary = patch.summary;
    if (patch?.startedAt !== undefined) payload.startedAt = patch.startedAt;
    if (patch?.completedAt !== undefined) payload.completedAt = patch.completedAt;
    await db.update(importExportJobs).set(payload).where(eq(importExportJobs.id, id));
  }

  private mapToDomain(row: ImportExportJobRow): ImportExportJob {
    return {
      id: row.id,
      type: row.type as ImportExportJobType,
      status: row.status as ImportExportJobStatus,
      requestedBy: row.requestedBy || null,
      progress: row.progress,
      errorSummary: row.errorSummary || null,
      artifactKey: row.artifactKey || null,
      artifactExpiresAt: row.artifactExpiresAt,
      summary: row.summary as Record<string, unknown> | null,
      createdAt: row.createdAt,
      startedAt: row.startedAt,
      completedAt: row.completedAt,
    };
  }
}
