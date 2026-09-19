import {
  CommentRepository,
  CommentLikeRepository,
  CommentReportRepository,
  CommentModerationEventRepository,
} from "../domain/repository";
import {
  Comment,
  CreateCommentData,
  MAX_COMMENT_DEPTH,
  MAX_COMMENT_BODY_LENGTH,
  CommentStatus,
  ModerationAction,
  ModerationEvent,
  CommentReport,
} from "../domain/comment";
import { domainEvents } from "@vibress/events";
import { runInTransaction } from "@vibress/database";

export class CommentDomainError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export interface NotificationSink {
  notify(data: {
    recipientId: string;
    type: string;
    actorMemberId: string | null;
    entityType: string;
    entityId: string;
    data?: Record<string, unknown> | null;
  }): Promise<void>;
}

export interface CommentsServiceDeps {
  commentRepo: CommentRepository;
  likeRepo: CommentLikeRepository;
  reportRepo: CommentReportRepository;
  moderationEventRepo: CommentModerationEventRepository;
  notificationSink: NotificationSink;
}

/**
 * Validates state machine transition.
 * Allowed transitions:
 * - pending_review -> published, rejected, deleted
 * - published -> hidden, deleted
 * - hidden -> published, deleted
 * - rejected -> deleted
 * - deleted -> (none, terminal)
 */
export function validateCommentTransition(
  fromStatus: string,
  toStatus: string,
): void {
  const allowedTransitions: Record<string, string[]> = {
    pending_review: ["published", "rejected", "deleted"],
    published: ["hidden", "deleted"],
    hidden: ["published", "deleted"],
    rejected: ["deleted"],
    deleted: [], // Terminal state
  };

  if (!allowedTransitions[fromStatus]?.includes(toStatus)) {
    throw new CommentDomainError(
      "INVALID_STATE_TRANSITION",
      `Illegal comment transition from '${fromStatus}' to '${toStatus}'`,
    );
  }
}

/**
 * Sanitizes comment body to plain text — no HTML is ever stored.
 * Strips all tags and control characters, enforces length limit.
 */
export function sanitizeCommentBody(body: string): string {
  const stripped = body.replace(/<[^>]*>/g, "");
  let clean = "";
  for (let i = 0; i < stripped.length; i++) {
    const code = stripped.charCodeAt(i);
    if (code < 32 && code !== 9 && code !== 10) continue;
    if (code === 127) continue;
    // Zero-width & invisible format characters (U+200B-U+200F, U+202A-U+202E, U+FEFF)
    if (
      (code >= 8203 && code <= 8207) ||
      (code >= 8234 && code <= 8238) ||
      code === 65279
    ) {
      continue;
    }
    clean += stripped[i];
  }
  return clean.trim().slice(0, MAX_COMMENT_BODY_LENGTH);
}

export class CommentsService {
  constructor(private deps: CommentsServiceDeps) {}

  async createComment(data: CreateCommentData): Promise<Comment> {
    return runInTransaction(() => this.createCommentTx(data));
  }

  private async createCommentTx(data: CreateCommentData): Promise<Comment> {
    // 1. Idempotency Check
    if (data.clientCommentId) {
      const existing = await this.deps.commentRepo.findByClientId(
        data.publicationId,
        data.memberId,
        data.clientCommentId,
      );
      if (existing) {
        return existing;
      }
    }

    const body = sanitizeCommentBody(data.body);
    if (!body) {
      throw new CommentDomainError("VALIDATION_ERROR", "Comment body is empty");
    }
    if (body.length > MAX_COMMENT_BODY_LENGTH) {
      throw new CommentDomainError(
        "VALIDATION_ERROR",
        `Comment body exceeds ${MAX_COMMENT_BODY_LENGTH} characters`,
      );
    }

    const parentId = data.parentId || null;
    let depth = 0;

    if (parentId) {
      const parent = await this.deps.commentRepo.findById(
        data.publicationId,
        parentId,
      );
      if (!parent) {
        throw new CommentDomainError(
          "COMMENT_NOT_FOUND",
          "Parent comment not found",
        );
      }
      if (parent.postId !== data.postId) {
        throw new CommentDomainError(
          "VALIDATION_ERROR",
          "Parent comment belongs to a different post",
        );
      }
      if (parent.status === "deleted" || parent.status === "hidden") {
        throw new CommentDomainError(
          "COMMENT_NOT_AVAILABLE",
          "Cannot reply to a hidden or deleted comment",
        );
      }
      depth = parent.depth + 1;
      if (depth > MAX_COMMENT_DEPTH) {
        throw new CommentDomainError(
          "MAX_THREAD_DEPTH",
          `Thread depth exceeds maximum of ${MAX_COMMENT_DEPTH}`,
        );
      }
    }

    const comment = await this.deps.commentRepo.create({
      ...data,
      body,
      parentId,
      depth,
    });

    if (parentId) {
      await this.deps.commentRepo.incrementReplyCount(
        data.publicationId,
        parentId,
        1,
      );
      domainEvents.emit("comment.replied", {
        publicationId: data.publicationId,
        commentId: comment.id,
        parentId,
        postId: comment.postId,
        memberId: comment.memberId,
      });

      // Notify parent comment author (if not self-reply)
      const parent = await this.deps.commentRepo.findById(
        data.publicationId,
        parentId,
      );
      if (parent && parent.memberId !== comment.memberId) {
        await this.deps.notificationSink.notify({
          recipientId: parent.memberId,
          type: "comment.reply",
          actorMemberId: comment.memberId,
          entityType: "comment",
          entityId: comment.id,
          data: { postId: comment.postId, parentId, publicationId: data.publicationId },
        });
      }
    }

    domainEvents.emit("comment.created", {
      publicationId: data.publicationId,
      commentId: comment.id,
      postId: comment.postId,
      memberId: comment.memberId,
      status: comment.status,
    });
    return comment;
  }

  async updateComment(
    publicationId: string,
    commentId: string,
    memberId: string,
    body: string,
  ): Promise<Comment> {
    const comment = await this.deps.commentRepo.findById(
      publicationId,
      commentId,
    );
    if (!comment) {
      throw new CommentDomainError("COMMENT_NOT_FOUND", "Comment not found");
    }
    if (comment.memberId !== memberId) {
      throw new CommentDomainError(
        "FORBIDDEN",
        "You can only edit your own comments",
      );
    }
    if (comment.status === "deleted") {
      throw new CommentDomainError(
        "COMMENT_NOT_AVAILABLE",
        "Cannot edit a deleted comment",
      );
    }

    const sanitized = sanitizeCommentBody(body);
    if (!sanitized) {
      throw new CommentDomainError("VALIDATION_ERROR", "Comment body is empty");
    }

    const updated = await this.deps.commentRepo.update(
      publicationId,
      commentId,
      {
        body: sanitized,
      },
    );
    domainEvents.emit("comment.updated", {
      publicationId,
      commentId,
      postId: comment.postId,
    });
    return updated;
  }

  async deleteComment(
    publicationId: string,
    commentId: string,
    memberId: string,
  ): Promise<Comment> {
    const comment = await this.deps.commentRepo.findById(
      publicationId,
      commentId,
    );
    if (!comment) {
      throw new CommentDomainError("COMMENT_NOT_FOUND", "Comment not found");
    }
    if (comment.memberId !== memberId) {
      throw new CommentDomainError(
        "FORBIDDEN",
        "You can only delete your own comments",
      );
    }

    // Tombstone: body is cleared, status set to deleted
    await this.deps.commentRepo.update(publicationId, commentId, {
      body: "[deleted]",
    });
    const updated = await this.deps.commentRepo.updateStatus(
      publicationId,
      commentId,
      "deleted",
    );
    domainEvents.emit("comment.deleted", {
      publicationId,
      commentId,
      postId: comment.postId,
    });
    return updated;
  }

  async toggleLike(
    publicationId: string,
    commentId: string,
    memberId: string,
  ): Promise<{ liked: boolean }> {
    const comment = await this.deps.commentRepo.findById(
      publicationId,
      commentId,
    );
    if (!comment) {
      throw new CommentDomainError("COMMENT_NOT_FOUND", "Comment not found");
    }
    if (comment.status === "deleted" || comment.status === "hidden") {
      throw new CommentDomainError(
        "COMMENT_NOT_AVAILABLE",
        "Cannot like a hidden or deleted comment",
      );
    }

    const result = await this.deps.likeRepo.toggle(
      publicationId,
      commentId,
      memberId,
    );
    await this.deps.commentRepo.incrementLikeCount(
      publicationId,
      commentId,
      result.liked ? 1 : -1,
    );

    if (result.liked) {
      domainEvents.emit("comment.liked", {
        publicationId,
        commentId,
        memberId,
        commentAuthorId: comment.memberId,
      });
    }
    return result;
  }

  async reportComment(
    publicationId: string,
    commentId: string,
    reporterId: string,
    reason: string,
  ): Promise<{ id: string; status: string }> {
    const comment = await this.deps.commentRepo.findById(
      publicationId,
      commentId,
    );
    if (!comment) {
      throw new CommentDomainError("COMMENT_NOT_FOUND", "Comment not found");
    }

    // Anti-Abuse: one active report per member per comment
    const already = await this.deps.reportRepo.exists(
      publicationId,
      commentId,
      reporterId,
    );
    if (already) {
      throw new CommentDomainError(
        "ALREADY_REPORTED",
        "You have already reported this comment",
      );
    }

    const sanitizedReason = reason.trim().slice(0, 500);
    if (!sanitizedReason) {
      throw new CommentDomainError(
        "VALIDATION_ERROR",
        "Report reason is required",
      );
    }

    const report = await this.deps.reportRepo.create(
      publicationId,
      commentId,
      reporterId,
      sanitizedReason,
    );
    domainEvents.emit("comment.reported", {
      publicationId,
      commentId,
      reporterId,
      postId: comment.postId,
    });
    return report;
  }

  async getComment(
    publicationId: string,
    commentId: string,
  ): Promise<Comment | null> {
    return this.deps.commentRepo.findById(publicationId, commentId);
  }

  async listPublicCommentsForPost(
    publicationId: string,
    postId: string,
    limit = 50,
    offset = 0,
  ): Promise<{ comments: Comment[]; total: number }> {
    return this.deps.commentRepo.listThreaded(
      publicationId,
      postId,
      limit,
      offset,
    );
  }

  async countCommentsForPost(
    publicationId: string,
    postId: string,
  ): Promise<number> {
    return this.deps.commentRepo.countForPost(publicationId, postId);
  }

  async getCommentCount(
    publicationId: string,
    postId: string,
  ): Promise<number> {
    return this.deps.commentRepo.countForPost(publicationId, postId);
  }

  async countCommentsForPosts(
    publicationId: string,
    postIds: string[],
  ): Promise<Map<string, number>> {
    return this.deps.commentRepo.countForPosts(publicationId, postIds);
  }

  async getCommentCounts(
    publicationId: string,
    postIds: string[],
  ): Promise<Map<string, number>> {
    return this.deps.commentRepo.countForPosts(publicationId, postIds);
  }

  async getLikedCommentIdsForMember(
    publicationId: string,
    memberId: string,
    commentIds: string[],
  ): Promise<Set<string>> {
    return this.deps.likeRepo.getLikedCommentIdsForMember(
      publicationId,
      memberId,
      commentIds,
    );
  }

  // ---------------- Moderation (Staff / Admin) ----------------

  async moderateComment(params: {
    publicationId: string;
    commentId: string;
    actorId: string;
    action: ModerationAction;
    reason?: string | undefined;
    metadata?: Record<string, unknown> | undefined;
  }): Promise<Comment> {
    return runInTransaction(async () => {
      const comment = await this.deps.commentRepo.findById(
        params.publicationId,
        params.commentId,
      );
      if (!comment) {
        throw new CommentDomainError("COMMENT_NOT_FOUND", "Comment not found");
      }

      let targetStatus: CommentStatus;

      switch (params.action) {
        case "approve":
        case "restore":
          targetStatus = "published";
          break;
        case "reject":
          targetStatus = "rejected";
          break;
        case "hide":
          targetStatus = "hidden";
          break;
        case "soft_delete":
          targetStatus = "deleted";
          break;
        case "hard_erase":
          targetStatus = "deleted";
          break;
        default:
          throw new CommentDomainError(
            "INVALID_ACTION",
            `Unknown moderation action: ${params.action}`,
          );
      }

      if (params.action !== "hard_erase") {
        validateCommentTransition(comment.status, targetStatus);
      }

      // Record immutable audit event in the same transaction
      await this.deps.moderationEventRepo.create({
        publicationId: params.publicationId,
        commentId: params.commentId,
        actorId: params.actorId,
        action: params.action,
        fromStatus: comment.status,
        toStatus: targetStatus,
        reason: params.reason || null,
        metadata: params.metadata || null,
      });

      if (params.action === "hard_erase") {
        await this.deps.commentRepo.hardErase(
          params.publicationId,
          params.commentId,
        );
        domainEvents.emit("comment.erased", {
          publicationId: params.publicationId,
          commentId: params.commentId,
          postId: comment.postId,
        });
        return { ...comment, status: "deleted" as CommentStatus };
      }

      if (params.action === "soft_delete") {
        await this.deps.commentRepo.update(
          params.publicationId,
          params.commentId,
          {
            body: "[removed by moderator]",
          },
        );
      }

      const updated = await this.deps.commentRepo.updateStatus(
        params.publicationId,
        params.commentId,
        targetStatus,
      );

      domainEvents.emit("comment.moderated", {
        publicationId: params.publicationId,
        commentId: params.commentId,
        postId: comment.postId,
        actorId: params.actorId,
        action: params.action,
        fromStatus: comment.status,
        toStatus: targetStatus,
      });

      if (params.action === "hide") {
        await this.deps.notificationSink.notify({
          recipientId: comment.memberId,
          type: "comment.hidden",
          actorMemberId: null,
          entityType: "comment",
          entityId: params.commentId,
          data: { postId: comment.postId, publicationId: params.publicationId },
        });
      }

      return updated;
    });
  }

  async hideComment(
    publicationId: string,
    commentId: string,
    actorId = "system",
  ): Promise<Comment> {
    return this.moderateComment({
      publicationId,
      commentId,
      actorId,
      action: "hide",
    });
  }

  async restoreComment(
    publicationId: string,
    commentId: string,
    actorId = "system",
  ): Promise<Comment> {
    return this.moderateComment({
      publicationId,
      commentId,
      actorId,
      action: "restore",
    });
  }

  async adminDeleteComment(
    publicationId: string,
    commentId: string,
    actorId = "system",
  ): Promise<Comment> {
    return this.moderateComment({
      publicationId,
      commentId,
      actorId,
      action: "soft_delete",
      reason: "Admin removed comment",
    });
  }

  async listModerationEvents(
    publicationId: string,
    commentId: string,
  ): Promise<ModerationEvent[]> {
    return this.deps.moderationEventRepo.listForComment(
      publicationId,
      commentId,
    );
  }

  async listCommentsForModeration(filter: {
    publicationId?: string | undefined;
    status?: string | undefined;
    postId?: string | undefined;
    limit?: number | undefined;
    offset?: number | undefined;
  }): Promise<{ comments: Comment[]; total: number }> {
    return this.deps.commentRepo.list({
      publicationId: filter.publicationId,
      status: filter.status as CommentStatus | undefined,
      postId: filter.postId,
      limit: filter.limit,
      offset: filter.offset,
    });
  }

  async listReports(filter: {
    publicationId?: string | undefined;
    status?: string | undefined;
    limit?: number | undefined;
    offset?: number | undefined;
  }): Promise<{ reports: CommentReport[]; total: number }> {
    return this.deps.reportRepo.list(filter);
  }

  async resolveReport(
    publicationId: string,
    reportId: string,
    action: string,
    resolvedBy: string,
  ): Promise<void> {
    await this.deps.reportRepo.resolve(
      publicationId,
      reportId,
      action,
      resolvedBy,
    );
  }
}

