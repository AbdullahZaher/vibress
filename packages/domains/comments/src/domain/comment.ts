export type CommentStatus =
  | "published"
  | "pending_review"
  | "hidden"
  | "deleted"
  | "rejected";

export type ModerationAction =
  | "approve"
  | "reject"
  | "hide"
  | "restore"
  | "soft_delete"
  | "hard_erase";

export interface Comment {
  id: string;
  publicationId: string;
  postId: string;
  memberId: string;
  parentId: string | null;
  body: string;
  status: CommentStatus;
  likeCount: number;
  replyCount: number;
  depth: number;
  clientCommentId?: string | null | undefined;
  member?: {
    id: string;
    name: string;
    avatarUrl?: string | null | undefined;
  } | undefined;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface CreateCommentData {
  id?: string | undefined;
  publicationId: string;
  postId: string;
  memberId: string;
  parentId?: string | null | undefined;
  body: string;
  depth?: number | undefined;
  status?: CommentStatus | undefined;
  clientCommentId?: string | null | undefined;
}

export interface UpdateCommentData {
  body: string;
}

export interface ListCommentsFilter {
  publicationId?: string | undefined;
  postId?: string | undefined;
  memberId?: string | undefined;
  status?: CommentStatus | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

export interface ModerationEvent {
  id: string;
  publicationId: string;
  commentId: string;
  actorId: string;
  action: ModerationAction;
  fromStatus: string;
  toStatus: string;
  reason: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

export interface CommentReport {
  id: string;
  publicationId: string;
  commentId: string;
  reporterId: string;
  reason: string;
  status: "pending" | "reviewed" | "dismissed";
  resolvedAt: Date | null;
  resolvedBy: string | null;
  createdAt: Date;
}

export interface PublicCommentDTO {
  id: string;
  postId: string;
  parentId: string | null;
  author: {
    id: string;
    name: string;
    avatarUrl?: string | null | undefined;
  };
  body: string | null; // Null for tombstones (deleted)
  status: "published" | "pending_review";
  likeCount: number;
  hasLiked: boolean;
  isDeleted: boolean;
  replyCount: number;
  depth: number;
  createdAt: string;
  replies?: PublicCommentDTO[] | undefined;
}

export const MAX_COMMENT_DEPTH = 5;
export const MAX_COMMENT_BODY_LENGTH = 5000;
