import {
  Comment,
  CreateCommentData,
  UpdateCommentData,
  ListCommentsFilter,
  ModerationEvent,
  CommentReport,
} from "./comment";

export interface CommentRepository {
  create(data: CreateCommentData): Promise<Comment>;
  findById(publicationId: string, id: string): Promise<Comment | null>;
  findByClientId(
    publicationId: string,
    memberId: string,
    clientCommentId: string,
  ): Promise<Comment | null>;
  update(publicationId: string, id: string, data: UpdateCommentData): Promise<Comment>;
  updateStatus(
    publicationId: string,
    id: string,
    status: string,
    deletedAt?: Date | null,
  ): Promise<Comment>;
  incrementLikeCount(publicationId: string, id: string, delta: number): Promise<void>;
  incrementReplyCount(publicationId: string, id: string, delta: number): Promise<void>;
  list(
    filter?: ListCommentsFilter,
  ): Promise<{ comments: Comment[]; total: number }>;
  listThreaded(
    publicationId: string,
    postId: string,
    limit?: number,
    offset?: number,
  ): Promise<{ comments: Comment[]; total: number }>;
  countForPost(publicationId: string, postId: string): Promise<number>;
  countForPosts(publicationId: string, postIds: string[]): Promise<Map<string, number>>;
  hardErase(publicationId: string, id: string): Promise<void>;
}

export interface CommentLikeRepository {
  toggle(
    publicationId: string,
    commentId: string,
    memberId: string,
  ): Promise<{ liked: boolean }>;
  exists(
    publicationId: string,
    commentId: string,
    memberId: string,
  ): Promise<boolean>;
  getLikedCommentIdsForMember(
    publicationId: string,
    memberId: string,
    commentIds: string[],
  ): Promise<Set<string>>;
}

export interface CommentReportRepository {
  create(
    publicationId: string,
    commentId: string,
    reporterId: string,
    reason: string,
  ): Promise<{ id: string; status: string }>;
  exists(
    publicationId: string,
    commentId: string,
    reporterId: string,
  ): Promise<boolean>;
  list(filter?: {
    publicationId?: string | undefined;
    status?: string | undefined;
    limit?: number | undefined;
    offset?: number | undefined;
  } | undefined): Promise<{
    reports: CommentReport[];
    total: number;
  }>;
  resolve(
    publicationId: string,
    id: string,
    status: string,
    resolvedBy: string,
  ): Promise<void>;
}

export interface CommentModerationEventRepository {
  create(
    event: Omit<ModerationEvent, "id" | "createdAt">,
  ): Promise<ModerationEvent>;
  listForComment(
    publicationId: string,
    commentId: string,
  ): Promise<ModerationEvent[]>;
}

