import {
  getDb,
  comments,
  CommentRow,
  commentLikes,
  commentReports,
  commentModerationEvents,
} from "@vibress/database";
import { eq, and, count, desc, sql, isNull, inArray } from "drizzle-orm";
import crypto from "node:crypto";
import {
  CommentRepository,
  CommentLikeRepository,
  CommentReportRepository,
  CommentModerationEventRepository,
} from "../domain/repository";
import {
  Comment,
  CreateCommentData,
  UpdateCommentData,
  ListCommentsFilter,
  CommentStatus,
  ModerationEvent,
  CommentReport,
} from "../domain/comment";

export class DrizzleCommentRepository implements CommentRepository {
  async create(data: CreateCommentData): Promise<Comment> {
    const db = getDb();
    const now = new Date();
    try {
      const [row] = await db
        .insert(comments)
        .values({
          id: data.id || crypto.randomUUID(),
          publicationId: data.publicationId,
          postId: data.postId,
          memberId: data.memberId,
          parentId: data.parentId || null,
          body: data.body,
          status: data.status || "published",
          depth: data.depth || 0,
          clientCommentId: data.clientCommentId || null,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (!row) throw new Error("Failed to insert comment");
      return this.mapToDomain(row);
    } catch (err: any) {
      if (
        data.clientCommentId &&
        (err?.code === "23505" ||
          err?.message?.includes("unique") ||
          err?.message?.includes("comments_pub_member_client_unique"))
      ) {
        const existing = await this.findByClientId(
          data.publicationId,
          data.memberId,
          data.clientCommentId,
        );
        if (existing) return existing;
      }
      throw err;
    }
  }

  async findById(publicationId: string, id: string): Promise<Comment | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(comments)
      .where(and(eq(comments.publicationId, publicationId), eq(comments.id, id)))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return this.mapToDomain(row);
  }

  async findByClientId(
    publicationId: string,
    memberId: string,
    clientCommentId: string,
  ): Promise<Comment | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(comments)
      .where(
        and(
          eq(comments.publicationId, publicationId),
          eq(comments.memberId, memberId),
          eq(comments.clientCommentId, clientCommentId),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return this.mapToDomain(row);
  }

  async update(
    publicationId: string,
    id: string,
    data: UpdateCommentData,
  ): Promise<Comment> {
    const db = getDb();
    const [row] = await db
      .update(comments)
      .set({ body: data.body, updatedAt: new Date() })
      .where(and(eq(comments.publicationId, publicationId), eq(comments.id, id)))
      .returning();
    if (!row) throw new Error(`Comment not found: ${id}`);
    return this.mapToDomain(row);
  }

  async updateStatus(
    publicationId: string,
    id: string,
    status: string,
    deletedAt: Date | null = null,
  ): Promise<Comment> {
    const db = getDb();
    const payload: Record<string, unknown> = { status, updatedAt: new Date() };
    if (status === "deleted") payload.deletedAt = deletedAt || new Date();
    if (status === "published") payload.deletedAt = null;
    const [row] = await db
      .update(comments)
      .set(payload)
      .where(and(eq(comments.publicationId, publicationId), eq(comments.id, id)))
      .returning();
    if (!row) throw new Error(`Comment not found: ${id}`);
    return this.mapToDomain(row);
  }

  async incrementLikeCount(
    publicationId: string,
    id: string,
    delta: number,
  ): Promise<void> {
    const db = getDb();
    await db
      .update(comments)
      .set({
        likeCount: sql`${comments.likeCount} + ${delta}`,
        updatedAt: new Date(),
      })
      .where(and(eq(comments.publicationId, publicationId), eq(comments.id, id)));
  }

  async incrementReplyCount(
    publicationId: string,
    id: string,
    delta: number,
  ): Promise<void> {
    const db = getDb();
    await db
      .update(comments)
      .set({
        replyCount: sql`${comments.replyCount} + ${delta}`,
        updatedAt: new Date(),
      })
      .where(and(eq(comments.publicationId, publicationId), eq(comments.id, id)));
  }

  async list(
    filter: ListCommentsFilter = {},
  ): Promise<{ comments: Comment[]; total: number }> {
    const db = getDb();
    const limit = Math.min(filter.limit || 20, 100);
    const offset = filter.offset || 0;
    const conditions = [];
    if (filter.publicationId)
      conditions.push(eq(comments.publicationId, filter.publicationId));
    if (filter.postId) conditions.push(eq(comments.postId, filter.postId));
    if (filter.memberId)
      conditions.push(eq(comments.memberId, filter.memberId));
    if (filter.status) conditions.push(eq(comments.status, filter.status));
    const whereClause = conditions.length ? and(...conditions) : undefined;

    const countRes = await db
      .select({ total: count() })
      .from(comments)
      .where(whereClause);
    const rows = await db
      .select()
      .from(comments)
      .where(whereClause)
      .orderBy(desc(comments.createdAt))
      .limit(limit)
      .offset(offset);
    return {
      comments: rows.map((r) => this.mapToDomain(r)),
      total: Number(countRes[0]?.total || 0),
    };
  }

  async listThreaded(
    publicationId: string,
    postId: string,
    limit = 50,
    offset = 0,
  ): Promise<{ comments: Comment[]; total: number }> {
    const db = getDb();
    const whereClause = and(
      eq(comments.publicationId, publicationId),
      eq(comments.postId, postId),
      eq(comments.status, "published"),
      isNull(comments.deletedAt),
    );

    const countRes = await db
      .select({ total: count() })
      .from(comments)
      .where(whereClause);

    const rows = await db
      .select()
      .from(comments)
      .where(whereClause)
      .orderBy(comments.createdAt)
      .limit(Math.min(limit, 100))
      .offset(offset);

    return {
      comments: rows.map((r) => this.mapToDomain(r)),
      total: Number(countRes[0]?.total || 0),
    };
  }

  async countForPost(publicationId: string, postId: string): Promise<number> {
    const db = getDb();
    const rows = await db
      .select({ total: count() })
      .from(comments)
      .where(
        and(
          eq(comments.publicationId, publicationId),
          eq(comments.postId, postId),
          eq(comments.status, "published"),
          isNull(comments.deletedAt),
        ),
      );
    return Number(rows[0]?.total || 0);
  }

  async countForPosts(
    publicationId: string,
    postIds: string[],
  ): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (postIds.length === 0) return result;
    for (const id of postIds) {
      result.set(id, 0);
    }

    const db = getDb();
    const rows = await db
      .select({
        postId: comments.postId,
        total: sql<number>`count(${comments.id}) filter (where ${comments.status} = 'published' and ${comments.deletedAt} is null)::int`,
      })
      .from(comments)
      .where(
        and(
          eq(comments.publicationId, publicationId),
          inArray(comments.postId, postIds),
        ),
      )
      .groupBy(comments.postId);

    for (const row of rows) {
      result.set(row.postId, Number(row.total || 0));
    }
    return result;
  }

  async hardErase(publicationId: string, id: string): Promise<void> {
    const db = getDb();
    await db
      .delete(comments)
      .where(and(eq(comments.publicationId, publicationId), eq(comments.id, id)));
  }

  private mapToDomain(row: CommentRow): Comment {
    return {
      id: row.id,
      publicationId: row.publicationId,
      postId: row.postId,
      memberId: row.memberId,
      parentId: row.parentId || null,
      body: row.body,
      status: row.status as CommentStatus,
      likeCount: row.likeCount,
      replyCount: row.replyCount,
      depth: row.depth,
      clientCommentId: row.clientCommentId || null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      deletedAt: row.deletedAt,
    };
  }
}

export class DrizzleCommentLikeRepository implements CommentLikeRepository {
  async toggle(
    publicationId: string,
    commentId: string,
    memberId: string,
  ): Promise<{ liked: boolean }> {
    const db = getDb();
    const existing = await db
      .select()
      .from(commentLikes)
      .where(
        and(
          eq(commentLikes.publicationId, publicationId),
          eq(commentLikes.commentId, commentId),
          eq(commentLikes.memberId, memberId),
        ),
      )
      .limit(1);

    if (existing[0]) {
      await db
        .delete(commentLikes)
        .where(
          and(
            eq(commentLikes.publicationId, publicationId),
            eq(commentLikes.commentId, commentId),
            eq(commentLikes.memberId, memberId),
          ),
        );
      return { liked: false };
    }

    try {
      await db.insert(commentLikes).values({
        id: crypto.randomUUID(),
        publicationId,
        commentId,
        memberId,
        createdAt: new Date(),
      });
      return { liked: true };
    } catch (err: any) {
      if (err?.code === "23505" || err?.message?.includes("unique")) {
        return { liked: true };
      }
      throw err;
    }
  }

  async exists(
    publicationId: string,
    commentId: string,
    memberId: string,
  ): Promise<boolean> {
    const db = getDb();
    const rows = await db
      .select({ id: commentLikes.id })
      .from(commentLikes)
      .where(
        and(
          eq(commentLikes.publicationId, publicationId),
          eq(commentLikes.commentId, commentId),
          eq(commentLikes.memberId, memberId),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  async getLikedCommentIdsForMember(
    publicationId: string,
    memberId: string,
    commentIds: string[],
  ): Promise<Set<string>> {
    if (commentIds.length === 0) return new Set();
    const db = getDb();
    const rows = await db
      .select({ commentId: commentLikes.commentId })
      .from(commentLikes)
      .where(
        and(
          eq(commentLikes.publicationId, publicationId),
          eq(commentLikes.memberId, memberId),
          inArray(commentLikes.commentId, commentIds),
        ),
      );
    return new Set(rows.map((r) => r.commentId));
  }
}

export class DrizzleCommentReportRepository implements CommentReportRepository {
  async create(
    publicationId: string,
    commentId: string,
    reporterId: string,
    reason: string,
  ): Promise<{ id: string; status: string }> {
    const db = getDb();
    const [row] = await db
      .insert(commentReports)
      .values({
        id: crypto.randomUUID(),
        publicationId,
        commentId,
        reporterId,
        reason,
        status: "pending",
        createdAt: new Date(),
      })
      .returning();
    if (!row) throw new Error("Failed to insert report");
    return { id: row.id, status: row.status };
  }

  async exists(
    publicationId: string,
    commentId: string,
    reporterId: string,
  ): Promise<boolean> {
    const db = getDb();
    const rows = await db
      .select({ id: commentReports.id })
      .from(commentReports)
      .where(
        and(
          eq(commentReports.publicationId, publicationId),
          eq(commentReports.commentId, commentId),
          eq(commentReports.reporterId, reporterId),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  async list(
    filter: {
      publicationId?: string;
      status?: string;
      limit?: number;
      offset?: number;
    } = {},
  ): Promise<{
    reports: CommentReport[];
    total: number;
  }> {
    const db = getDb();
    const limit = Math.min(filter.limit || 50, 100);
    const offset = filter.offset || 0;
    const conditions = [];
    if (filter.publicationId)
      conditions.push(eq(commentReports.publicationId, filter.publicationId));
    if (filter.status)
      conditions.push(eq(commentReports.status, filter.status));
    const whereClause = conditions.length ? and(...conditions) : undefined;

    const countRes = await db
      .select({ total: count() })
      .from(commentReports)
      .where(whereClause);
    const rows = await db
      .select()
      .from(commentReports)
      .where(whereClause)
      .orderBy(desc(commentReports.createdAt))
      .limit(limit)
      .offset(offset);

    return {
      reports: rows.map((r) => ({
        id: r.id,
        publicationId: r.publicationId,
        commentId: r.commentId,
        reporterId: r.reporterId,
        reason: r.reason,
        status: r.status as "pending" | "reviewed" | "dismissed",
        resolvedAt: r.resolvedAt,
        resolvedBy: r.resolvedBy || null,
        createdAt: r.createdAt,
      })),
      total: Number(countRes[0]?.total || 0),
    };
  }

  async resolve(
    publicationId: string,
    id: string,
    status: string,
    resolvedBy: string,
  ): Promise<void> {
    const db = getDb();
    await db
      .update(commentReports)
      .set({ status, resolvedAt: new Date(), resolvedBy })
      .where(
        and(
          eq(commentReports.publicationId, publicationId),
          eq(commentReports.id, id),
        ),
      );
  }
}

export class DrizzleCommentModerationEventRepository
  implements CommentModerationEventRepository
{
  async create(
    event: Omit<ModerationEvent, "id" | "createdAt">,
  ): Promise<ModerationEvent> {
    const db = getDb();
    const now = new Date();
    const [row] = await db
      .insert(commentModerationEvents)
      .values({
        id: crypto.randomUUID(),
        publicationId: event.publicationId,
        commentId: event.commentId,
        actorId: event.actorId,
        action: event.action,
        fromStatus: event.fromStatus,
        toStatus: event.toStatus,
        reason: event.reason || null,
        metadata: event.metadata || null,
        createdAt: now,
      })
      .returning();
    if (!row) throw new Error("Failed to insert moderation event");
    return {
      id: row.id,
      publicationId: row.publicationId,
      commentId: row.commentId,
      actorId: row.actorId,
      action: row.action as any,
      fromStatus: row.fromStatus,
      toStatus: row.toStatus,
      reason: row.reason,
      metadata: row.metadata as Record<string, unknown> | null,
      createdAt: row.createdAt,
    };
  }

  async listForComment(
    publicationId: string,
    commentId: string,
  ): Promise<ModerationEvent[]> {
    const db = getDb();
    const rows = await db
      .select()
      .from(commentModerationEvents)
      .where(
        and(
          eq(commentModerationEvents.publicationId, publicationId),
          eq(commentModerationEvents.commentId, commentId),
        ),
      )
      .orderBy(desc(commentModerationEvents.createdAt));

    return rows.map((r) => ({
      id: r.id,
      publicationId: r.publicationId,
      commentId: r.commentId,
      actorId: r.actorId,
      action: r.action as any,
      fromStatus: r.fromStatus,
      toStatus: r.toStatus,
      reason: r.reason,
      metadata: r.metadata as Record<string, unknown> | null,
      createdAt: r.createdAt,
    }));
  }
}

