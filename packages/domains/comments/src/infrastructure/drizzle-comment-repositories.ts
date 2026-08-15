import {
  getDb,
  comments,
  CommentRow,
  commentLikes,
  commentReports,
} from "@vibress/database";
import { eq, and, count, desc, sql, isNull } from "drizzle-orm";
import crypto from "node:crypto";
import {
  CommentRepository,
  CommentLikeRepository,
  CommentReportRepository,
} from "../domain/repository";
import {
  Comment,
  CreateCommentData,
  UpdateCommentData,
  ListCommentsFilter,
  CommentStatus,
} from "../domain/comment";

export class DrizzleCommentRepository implements CommentRepository {
  async create(data: CreateCommentData): Promise<Comment> {
    const db = getDb();
    const now = new Date();
    const [row] = await db
      .insert(comments)
      .values({
        id: data.id || crypto.randomUUID(),
        postId: data.postId,
        memberId: data.memberId,
        parentId: data.parentId || null,
        body: data.body,
        status: data.status || "published",
        depth: data.depth || 0,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!row) throw new Error("Failed to insert comment");
    return this.mapToDomain(row);
  }

  async findById(id: string): Promise<Comment | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(comments)
      .where(eq(comments.id, id))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return this.mapToDomain(row);
  }

  async update(id: string, data: UpdateCommentData): Promise<Comment> {
    const db = getDb();
    const [row] = await db
      .update(comments)
      .set({ body: data.body, updatedAt: new Date() })
      .where(eq(comments.id, id))
      .returning();
    if (!row) throw new Error(`Comment not found: ${id}`);
    return this.mapToDomain(row);
  }

  async updateStatus(
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
      .where(eq(comments.id, id))
      .returning();
    if (!row) throw new Error(`Comment not found: ${id}`);
    return this.mapToDomain(row);
  }

  async incrementLikeCount(id: string, delta: number): Promise<void> {
    const db = getDb();
    await db
      .update(comments)
      .set({
        likeCount: sql`${comments.likeCount} + ${delta}`,
        updatedAt: new Date(),
      })
      .where(eq(comments.id, id));
  }

  async incrementReplyCount(id: string, delta: number): Promise<void> {
    const db = getDb();
    await db
      .update(comments)
      .set({
        replyCount: sql`${comments.replyCount} + ${delta}`,
        updatedAt: new Date(),
      })
      .where(eq(comments.id, id));
  }

  async list(
    filter: ListCommentsFilter = {},
  ): Promise<{ comments: Comment[]; total: number }> {
    const db = getDb();
    const limit = Math.min(filter.limit || 20, 100);
    const offset = filter.offset || 0;
    const conditions = [];
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
    postId: string,
    limit = 50,
    offset = 0,
  ): Promise<{ comments: Comment[]; total: number }> {
    const db = getDb();
    // List published + not deleted comments for a post, ordered for threaded display
    const countRes = await db
      .select({ total: count() })
      .from(comments)
      .where(
        and(
          eq(comments.postId, postId),
          eq(comments.status, "published"),
          isNull(comments.deletedAt),
        ),
      );

    const rows = await db
      .select()
      .from(comments)
      .where(
        and(
          eq(comments.postId, postId),
          eq(comments.status, "published"),
          isNull(comments.deletedAt),
        ),
      )
      .orderBy(comments.createdAt)
      .limit(Math.min(limit, 100))
      .offset(offset);

    return {
      comments: rows.map((r) => this.mapToDomain(r)),
      total: Number(countRes[0]?.total || 0),
    };
  }

  async countForPost(postId: string): Promise<number> {
    const db = getDb();
    const rows = await db
      .select({ total: count() })
      .from(comments)
      .where(
        and(
          eq(comments.postId, postId),
          eq(comments.status, "published"),
          isNull(comments.deletedAt),
        ),
      );
    return Number(rows[0]?.total || 0);
  }

  private mapToDomain(row: CommentRow): Comment {
    return {
      id: row.id,
      postId: row.postId,
      memberId: row.memberId,
      parentId: row.parentId || null,
      body: row.body,
      status: row.status as CommentStatus,
      likeCount: row.likeCount,
      replyCount: row.replyCount,
      depth: row.depth,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      deletedAt: row.deletedAt,
    };
  }
}

export class DrizzleCommentLikeRepository implements CommentLikeRepository {
  async toggle(
    commentId: string,
    memberId: string,
  ): Promise<{ liked: boolean }> {
    const db = getDb();
    // Try to insert; if exists, delete (toggle)
    const existing = await db
      .select()
      .from(commentLikes)
      .where(
        and(
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
            eq(commentLikes.commentId, commentId),
            eq(commentLikes.memberId, memberId),
          ),
        );
      return { liked: false };
    }

    await db.insert(commentLikes).values({
      id: crypto.randomUUID(),
      commentId,
      memberId,
      createdAt: new Date(),
    });
    return { liked: true };
  }

  async exists(commentId: string, memberId: string): Promise<boolean> {
    const db = getDb();
    const rows = await db
      .select({ id: commentLikes.id })
      .from(commentLikes)
      .where(
        and(
          eq(commentLikes.commentId, commentId),
          eq(commentLikes.memberId, memberId),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }
}

export class DrizzleCommentReportRepository implements CommentReportRepository {
  async create(
    commentId: string,
    reporterId: string,
    reason: string,
  ): Promise<{ id: string; status: string }> {
    const db = getDb();
    const [row] = await db
      .insert(commentReports)
      .values({
        id: crypto.randomUUID(),
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

  async exists(commentId: string, reporterId: string): Promise<boolean> {
    const db = getDb();
    const rows = await db
      .select({ id: commentReports.id })
      .from(commentReports)
      .where(
        and(
          eq(commentReports.commentId, commentId),
          eq(commentReports.reporterId, reporterId),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  async list(
    filter: { status?: string; limit?: number; offset?: number } = {},
  ): Promise<{
    reports: Array<{
      id: string;
      commentId: string;
      reporterId: string;
      reason: string;
      status: string;
      resolvedAt: Date | null;
      resolvedBy: string | null;
      createdAt: Date;
    }>;
    total: number;
  }> {
    const db = getDb();
    const limit = Math.min(filter.limit || 50, 100);
    const offset = filter.offset || 0;
    const conditions = [];
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
        commentId: r.commentId,
        reporterId: r.reporterId,
        reason: r.reason,
        status: r.status,
        resolvedAt: r.resolvedAt,
        resolvedBy: r.resolvedBy || null,
        createdAt: r.createdAt,
      })),
      total: Number(countRes[0]?.total || 0),
    };
  }

  async resolve(id: string, status: string, resolvedBy: string): Promise<void> {
    const db = getDb();
    await db
      .update(commentReports)
      .set({ status, resolvedAt: new Date(), resolvedBy })
      .where(eq(commentReports.id, id));
  }
}
