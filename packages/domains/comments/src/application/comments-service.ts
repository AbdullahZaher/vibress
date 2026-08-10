import { CommentRepository, CommentLikeRepository, CommentReportRepository } from '../domain/repository';
import { Comment, CreateCommentData, MAX_COMMENT_DEPTH, MAX_COMMENT_BODY_LENGTH, CommentStatus } from '../domain/comment';
import { domainEvents } from '@vibress/events';

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
  notificationSink: NotificationSink;
}

/**
 * Sanitizes comment body to plain text — no HTML is ever stored or rendered.
 * Strips all tags and control characters, enforces length limit.
 */
export function sanitizeCommentBody(body: string): string {
  // Strip any HTML tags (defense in depth — body is always treated as plain text)
  const stripped = body.replace(/<[^>]*>/g, '');
  // Remove control characters via charCodeAt (no-control-regex safe)
  let clean = '';
  for (let i = 0; i < stripped.length; i++) {
    const code = stripped.charCodeAt(i);
    if (code < 32 && code !== 9 && code !== 10) continue;
    if (code === 127) continue;
    clean += stripped[i];
  }
  return clean.trim().slice(0, MAX_COMMENT_BODY_LENGTH);
}

export class CommentsService {
  constructor(private deps: CommentsServiceDeps) {}

  async createComment(data: CreateCommentData): Promise<Comment> {
    const body = sanitizeCommentBody(data.body);
    if (!body) throw new CommentDomainError('VALIDATION_ERROR', 'Comment body is empty');
    if (body.length > MAX_COMMENT_BODY_LENGTH) {
      throw new CommentDomainError('VALIDATION_ERROR', `Comment body exceeds ${MAX_COMMENT_BODY_LENGTH} characters`);
    }

    const parentId = data.parentId || null;
    let depth = 0;

    if (parentId) {
      const parent = await this.deps.commentRepo.findById(parentId);
      if (!parent) throw new CommentDomainError('COMMENT_NOT_FOUND', 'Parent comment not found');
      if (parent.postId !== data.postId) {
        throw new CommentDomainError('VALIDATION_ERROR', 'Parent comment belongs to a different post');
      }
      if (parent.status === 'deleted' || parent.status === 'hidden') {
        throw new CommentDomainError('COMMENT_NOT_AVAILABLE', 'Cannot reply to a hidden or deleted comment');
      }
      depth = parent.depth + 1;
      if (depth > MAX_COMMENT_DEPTH) {
        throw new CommentDomainError('MAX_THREAD_DEPTH', `Thread depth exceeds maximum of ${MAX_COMMENT_DEPTH}`);
      }
    }

    const comment = await this.deps.commentRepo.create({
      ...data,
      body,
      parentId,
      depth,
    });

    if (parentId) {
      await this.deps.commentRepo.incrementReplyCount(parentId, 1);
      domainEvents.emit('comment.replied', { commentId: comment.id, parentId, postId: comment.postId, memberId: comment.memberId });

      // Notify parent comment author (if not self-reply)
      const parent = await this.deps.commentRepo.findById(parentId);
      if (parent && parent.memberId !== comment.memberId) {
        await this.deps.notificationSink.notify({
          recipientId: parent.memberId,
          type: 'comment.reply',
          actorMemberId: comment.memberId,
          entityType: 'comment',
          entityId: comment.id,
          data: { postId: comment.postId, parentId },
        });
      }
    }

    domainEvents.emit('comment.created', { commentId: comment.id, postId: comment.postId, memberId: comment.memberId });
    return comment;
  }

  async updateComment(commentId: string, memberId: string, body: string): Promise<Comment> {
    const comment = await this.deps.commentRepo.findById(commentId);
    if (!comment) throw new CommentDomainError('COMMENT_NOT_FOUND', 'Comment not found');
    if (comment.memberId !== memberId) {
      throw new CommentDomainError('FORBIDDEN', 'You can only edit your own comments');
    }
    if (comment.status === 'deleted') {
      throw new CommentDomainError('COMMENT_NOT_AVAILABLE', 'Cannot edit a deleted comment');
    }

    const sanitized = sanitizeCommentBody(body);
    if (!sanitized) throw new CommentDomainError('VALIDATION_ERROR', 'Comment body is empty');

    const updated = await this.deps.commentRepo.update(commentId, { body: sanitized });
    domainEvents.emit('comment.updated', { commentId, postId: comment.postId });
    return updated;
  }

  async deleteComment(commentId: string, memberId: string): Promise<Comment> {
    const comment = await this.deps.commentRepo.findById(commentId);
    if (!comment) throw new CommentDomainError('COMMENT_NOT_FOUND', 'Comment not found');
    if (comment.memberId !== memberId) {
      throw new CommentDomainError('FORBIDDEN', 'You can only delete your own comments');
    }

    // Tombstone: body is cleared, status set to deleted
    // Thread integrity preserved — replies remain, parent becomes a tombstone
    await this.deps.commentRepo.update(commentId, { body: '[deleted]' });
    const updated = await this.deps.commentRepo.updateStatus(commentId, 'deleted');
    domainEvents.emit('comment.deleted', { commentId, postId: comment.postId });
    return updated;
  }

  async toggleLike(commentId: string, memberId: string): Promise<{ liked: boolean }> {
    const comment = await this.deps.commentRepo.findById(commentId);
    if (!comment) throw new CommentDomainError('COMMENT_NOT_FOUND', 'Comment not found');
    if (comment.status === 'deleted' || comment.status === 'hidden') {
      throw new CommentDomainError('COMMENT_NOT_AVAILABLE', 'Cannot like a hidden or deleted comment');
    }

    const result = await this.deps.likeRepo.toggle(commentId, memberId);
    await this.deps.commentRepo.incrementLikeCount(commentId, result.liked ? 1 : -1);

    if (result.liked) {
      domainEvents.emit('comment.liked', { commentId, memberId, commentAuthorId: comment.memberId });
    }
    return result;
  }

  async reportComment(commentId: string, reporterId: string, reason: string): Promise<{ id: string; status: string }> {
    const comment = await this.deps.commentRepo.findById(commentId);
    if (!comment) throw new CommentDomainError('COMMENT_NOT_FOUND', 'Comment not found');

    // Spam protection: one report per member per comment
    const already = await this.deps.reportRepo.exists(commentId, reporterId);
    if (already) {
      throw new CommentDomainError('ALREADY_REPORTED', 'You have already reported this comment');
    }

    const sanitizedReason = reason.trim().slice(0, 500);
    if (!sanitizedReason) throw new CommentDomainError('VALIDATION_ERROR', 'Report reason is required');

    const report = await this.deps.reportRepo.create(commentId, reporterId, sanitizedReason);
    domainEvents.emit('comment.reported', { commentId, reporterId, postId: comment.postId });
    return report;
  }

  async getComment(commentId: string): Promise<Comment | null> {
    return this.deps.commentRepo.findById(commentId);
  }

  async listPublicCommentsForPost(postId: string, limit = 50, offset = 0): Promise<{ comments: Comment[]; total: number }> {
    return this.deps.commentRepo.listThreaded(postId, limit, offset);
  }

  async countCommentsForPost(postId: string): Promise<number> {
    return this.deps.commentRepo.countForPost(postId);
  }

  // ---------------- Moderation (staff) ----------------

  async hideComment(commentId: string): Promise<Comment> {
    const comment = await this.deps.commentRepo.findById(commentId);
    if (!comment) throw new CommentDomainError('COMMENT_NOT_FOUND', 'Comment not found');
    const updated = await this.deps.commentRepo.updateStatus(commentId, 'hidden');
    domainEvents.emit('comment.hidden', { commentId, postId: comment.postId });

    // Notify the comment author
    await this.deps.notificationSink.notify({
      recipientId: comment.memberId,
      type: 'comment.hidden',
      actorMemberId: null,
      entityType: 'comment',
      entityId: commentId,
      data: { postId: comment.postId },
    });
    return updated;
  }

  async restoreComment(commentId: string): Promise<Comment> {
    const comment = await this.deps.commentRepo.findById(commentId);
    if (!comment) throw new CommentDomainError('COMMENT_NOT_FOUND', 'Comment not found');
    const updated = await this.deps.commentRepo.updateStatus(commentId, 'published');
    return updated;
  }

  async adminDeleteComment(commentId: string): Promise<Comment> {
    const comment = await this.deps.commentRepo.findById(commentId);
    if (!comment) throw new CommentDomainError('COMMENT_NOT_FOUND', 'Comment not found');
    await this.deps.commentRepo.update(commentId, { body: '[removed by moderator]' });
    const updated = await this.deps.commentRepo.updateStatus(commentId, 'deleted');
    domainEvents.emit('comment.deleted', { commentId, postId: comment.postId, byModerator: true });
    return updated;
  }

  async listCommentsForModeration(filter: { status?: string; postId?: string; limit?: number; offset?: number }): Promise<{ comments: Comment[]; total: number }> {
    return this.deps.commentRepo.list({
      status: filter.status as CommentStatus | undefined,
      postId: filter.postId,
      limit: filter.limit,
      offset: filter.offset,
    });
  }

  async listReports(filter: { status?: string; limit?: number; offset?: number }): Promise<{ reports: Array<Record<string, unknown>>; total: number }> {
    return this.deps.reportRepo.list(filter);
  }

  async resolveReport(reportId: string, action: string, resolvedBy: string): Promise<void> {
    await this.deps.reportRepo.resolve(reportId, action, resolvedBy);
  }
}
