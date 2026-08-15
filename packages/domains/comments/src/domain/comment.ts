export type CommentStatus = 'published' | 'pending_review' | 'hidden' | 'deleted';

export interface Comment {
  id: string;
  postId: string;
  memberId: string;
  parentId: string | null;
  body: string;
  status: CommentStatus;
  likeCount: number;
  replyCount: number;
  depth: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface CreateCommentData {
  id?: string | undefined;
  postId: string;
  memberId: string;
  parentId?: string | null | undefined;
  body: string;
  depth?: number | undefined;
  status?: CommentStatus | undefined;
}

export interface UpdateCommentData {
  body: string;
}

export interface ListCommentsFilter {
  postId?: string | undefined;
  memberId?: string | undefined;
  status?: CommentStatus | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

export const MAX_COMMENT_DEPTH = 5;
export const MAX_COMMENT_BODY_LENGTH = 5000;
