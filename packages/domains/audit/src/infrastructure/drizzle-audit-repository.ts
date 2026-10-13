import { getDb, auditEvents, posts, pages, mediaAssets } from "@vibress/database";
import { eq, and, desc, count, gte, lte } from "drizzle-orm";
import { AuditRepository, AuditListFilter } from "../domain/repository";
import {
  AuditEvent,
  CreateAuditEventData,
  sanitizeAuditMetadata,
} from "../domain/audit-event";
import crypto from "node:crypto";

function normalizePublicationId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function extractPublicationIdFromMetadata(
  metadata: Record<string, unknown> | null,
): string | null {
  if (!metadata) return null;
  return (
    normalizePublicationId(metadata.publicationId) ??
    normalizePublicationId(metadata.publication_id)
  );
}

export class DrizzleAuditRepository implements AuditRepository {
  async record(data: CreateAuditEventData): Promise<AuditEvent> {
    const db = getDb();
    const id = data.id || crypto.randomUUID();
    const sanitizedMeta = sanitizeAuditMetadata(data.metadata);
    const publicationId = await this.resolvePublicationId(data, sanitizedMeta);
    const now = new Date();

    const [row] = await db
      .insert(auditEvents)
      .values({
        id,
        publicationId,
        actorUserId: data.actorUserId || null,
        action: data.action,
        targetType: data.targetType || null,
        targetId: data.targetId || null,
        ipAddress: data.ipAddress || null,
        userAgent: data.userAgent || null,
        requestId: data.requestId || null,
        metadata: sanitizedMeta,
        createdAt: now,
      })
      .returning();

    if (!row) throw new Error("Failed to insert audit event");
    return this.mapToDomain(row);
  }

  async listAll(limit = 100): Promise<AuditEvent[]> {
    const db = getDb();
    const rows = await db
      .select()
      .from(auditEvents)
      .orderBy(desc(auditEvents.createdAt))
      .limit(limit);
    return rows.map((r) => this.mapToDomain(r));
  }

  async list(
    filter: AuditListFilter = {},
  ): Promise<{ events: AuditEvent[]; total: number }> {
    const db = getDb();
    const limit = Math.min(filter.limit || 50, 100);
    const offset = filter.offset || 0;
    const conditions = [];
    if (filter.publicationId)
      conditions.push(eq(auditEvents.publicationId, filter.publicationId));
    if (filter.actorUserId)
      conditions.push(eq(auditEvents.actorUserId, filter.actorUserId));
    if (filter.action) conditions.push(eq(auditEvents.action, filter.action));
    if (filter.targetType)
      conditions.push(eq(auditEvents.targetType, filter.targetType));
    if (filter.targetId)
      conditions.push(eq(auditEvents.targetId, filter.targetId));
    if (filter.requestId)
      conditions.push(eq(auditEvents.requestId, filter.requestId));
    if (filter.from) conditions.push(gte(auditEvents.createdAt, filter.from));
    if (filter.to) conditions.push(lte(auditEvents.createdAt, filter.to));
    const whereClause = conditions.length ? and(...conditions) : undefined;

    const countRes = await db
      .select({ total: count() })
      .from(auditEvents)
      .where(whereClause);
    const rows = await db
      .select()
      .from(auditEvents)
      .where(whereClause)
      .orderBy(desc(auditEvents.createdAt))
      .limit(limit)
      .offset(offset);
    return {
      events: rows.map((r) => this.mapToDomain(r)),
      total: Number(countRes[0]?.total || 0),
    };
  }

  private async resolvePublicationId(
    data: CreateAuditEventData,
    metadata: Record<string, unknown> | null,
  ): Promise<string | null> {
    const explicitPublicationId =
      normalizePublicationId(data.publicationId) ??
      extractPublicationIdFromMetadata(metadata);
    if (explicitPublicationId) return explicitPublicationId;
    if (!data.targetType || !data.targetId) return null;

    const db = getDb();
    switch (data.targetType) {
      case "post": {
        const [row] = await db
          .select({ publicationId: posts.publicationId })
          .from(posts)
          .where(eq(posts.id, data.targetId))
          .limit(1);
        return row?.publicationId ?? null;
      }
      case "page": {
        const [row] = await db
          .select({ publicationId: pages.publicationId })
          .from(pages)
          .where(eq(pages.id, data.targetId))
          .limit(1);
        return row?.publicationId ?? null;
      }
      case "media": {
        const [row] = await db
          .select({ publicationId: mediaAssets.publicationId })
          .from(mediaAssets)
          .where(eq(mediaAssets.id, data.targetId))
          .limit(1);
        return row?.publicationId ?? null;
      }
      default:
        return null;
    }
  }

  private mapToDomain(row: typeof auditEvents.$inferSelect): AuditEvent {
    return {
      id: row.id,
      publicationId: row.publicationId,
      actorUserId: row.actorUserId,
      action: row.action,
      targetType: row.targetType,
      targetId: row.targetId,
      ipAddress: row.ipAddress,
      userAgent: row.userAgent,
      requestId: row.requestId,
      metadata: row.metadata as Record<string, unknown> | null,
      createdAt: row.createdAt,
    };
  }
}
