import {
  getDb,
  recommendations,
  RecommendationRow,
  recommendationEvents,
} from "@vibress/database";
import { eq, isNull, count } from "drizzle-orm";
import crypto from "node:crypto";
import {
  RecommendationRepository,
  RecommendationEventRepository,
} from "../domain/repository";
import {
  Recommendation,
  CreateRecommendationData,
  UpdateRecommendationData,
  RecommendationStatus,
} from "../domain/recommendation";

export class DrizzleRecommendationRepository implements RecommendationRepository {
  async create(data: CreateRecommendationData): Promise<Recommendation> {
    const db = getDb();
    const now = new Date();
    const [row] = await db
      .insert(recommendations)
      .values({
        id: data.id || crypto.randomUUID(),
        url: data.url,
        title: data.title,
        description: data.description || null,
        imageUrl: data.imageUrl || null,
        faviconUrl: data.faviconUrl || null,
        status: data.status || "active",
        sortOrder: data.sortOrder || 0,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!row) throw new Error("Failed to insert recommendation");
    return this.mapToDomain(row);
  }

  async findById(id: string): Promise<Recommendation | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(recommendations)
      .where(eq(recommendations.id, id))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return this.mapToDomain(row);
  }

  async update(
    id: string,
    data: UpdateRecommendationData,
  ): Promise<Recommendation> {
    const db = getDb();
    const payload: Record<string, unknown> = { updatedAt: new Date() };
    if (data.title !== undefined) payload.title = data.title;
    if (data.description !== undefined) payload.description = data.description;
    if (data.imageUrl !== undefined) payload.imageUrl = data.imageUrl;
    if (data.faviconUrl !== undefined) payload.faviconUrl = data.faviconUrl;
    if (data.status !== undefined) payload.status = data.status;
    if (data.sortOrder !== undefined) payload.sortOrder = data.sortOrder;
    const [row] = await db
      .update(recommendations)
      .set(payload)
      .where(eq(recommendations.id, id))
      .returning();
    if (!row) throw new Error(`Recommendation not found: ${id}`);
    return this.mapToDomain(row);
  }

  async archive(id: string): Promise<Recommendation> {
    const db = getDb();
    const [row] = await db
      .update(recommendations)
      .set({ status: "archived", updatedAt: new Date() })
      .where(eq(recommendations.id, id))
      .returning();
    if (!row) throw new Error(`Recommendation not found: ${id}`);
    return this.mapToDomain(row);
  }

  async list(filter?: {
    includeArchived?: boolean;
  }): Promise<Recommendation[]> {
    const db = getDb();
    const rows = await db
      .select()
      .from(recommendations)
      .where(
        filter?.includeArchived
          ? undefined
          : isNull(recommendations.sortOrder) /* placeholder */,
      )
      .orderBy(recommendations.sortOrder, recommendations.createdAt);
    // Filter manually for simplicity (status check)
    const filtered = filter?.includeArchived
      ? rows
      : rows.filter((r) => r.status === "active");
    return filtered.map((r) => this.mapToDomain(r));
  }

  async listActive(): Promise<Recommendation[]> {
    const db = getDb();
    const rows = await db
      .select()
      .from(recommendations)
      .where(eq(recommendations.status, "active"))
      .orderBy(recommendations.sortOrder, recommendations.createdAt);
    return rows.map((r) => this.mapToDomain(r));
  }

  private mapToDomain(row: RecommendationRow): Recommendation {
    return {
      id: row.id,
      url: row.url,
      title: row.title,
      description: row.description || null,
      imageUrl: row.imageUrl || null,
      faviconUrl: row.faviconUrl || null,
      status: row.status as RecommendationStatus,
      sortOrder: row.sortOrder,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

export class DrizzleRecommendationEventRepository implements RecommendationEventRepository {
  async record(data: {
    recommendationId: string;
    memberId?: string | null;
    type: string;
    sessionId?: string | null;
  }): Promise<void> {
    const db = getDb();
    await db.insert(recommendationEvents).values({
      id: crypto.randomUUID(),
      recommendationId: data.recommendationId,
      memberId: data.memberId || null,
      type: data.type,
      sessionId: data.sessionId || null,
      createdAt: new Date(),
    });
  }

  async countByType(recommendationId: string): Promise<Record<string, number>> {
    const db = getDb();
    const rows = await db
      .select({ type: recommendationEvents.type, total: count() })
      .from(recommendationEvents)
      .where(eq(recommendationEvents.recommendationId, recommendationId))
      .groupBy(recommendationEvents.type);
    const result: Record<string, number> = {};
    for (const row of rows) result[row.type] = Number(row.total);
    return result;
  }
}
