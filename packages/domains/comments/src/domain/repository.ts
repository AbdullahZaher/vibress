import {
  Comment,
  CreateCommentData,
  UpdateCommentData,
  ListCommentsFilter,
} from "./comment";

export interface CommentRepository {
  create(data: CreateCommentData): Promise<Comment>;
  findById(id: string): Promise<Comment | null>;
  update(id: string, data: UpdateCommentData): Promise<Comment>;
  updateStatus(
    id: string,
    status: string,
    deletedAt?: Date | null,
  ): Promise<Comment>;
  incrementLikeCount(id: string, delta: number): Promise<void>;
  incrementReplyCount(id: string, delta: number): Promise<void>;
  list(
    filter?: ListCommentsFilter,
  ): Promise<{ comments: Comment[]; total: number }>;
  listThreaded(
    postId: string,
    limit?: number,
    offset?: number,
  ): Promise<{ comments: Comment[]; total: number }>;
  countForPost(postId: string): Promise<number>;
}

export interface CommentLikeRepository {
  toggle(commentId: string, memberId: string): Promise<{ liked: boolean }>;
  exists(commentId: string, memberId: string): Promise<boolean>;
}

export interface CommentReportRepository {
  create(
    commentId: string,
    reporterId: string,
    reason: string,
  ): Promise<{ id: string; status: string }>;
  exists(commentId: string, reporterId: string): Promise<boolean>;
  list(filter?: {
    status?: string;
    limit?: number;
    offset?: number;
  }): Promise<{
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
  }>;
  resolve(id: string, status: string, resolvedBy: string): Promise<void>;
}
