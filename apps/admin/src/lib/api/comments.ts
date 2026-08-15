import { apiRequest } from "./client";

export interface AdminComment {
  id: string;
  postId: string;
  memberId: string;
  parentId: string | null;
  body: string;
  status: string;
  likeCount: number;
  replyCount: number;
  createdAt: string;
}

export interface AdminCommentReport {
  id: string;
  commentId: string;
  reporterId: string;
  reason: string;
  status: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  createdAt: string;
}

export async function listCommentsApi(
  params: {
    status?: string;
    postId?: string;
    limit?: number;
    offset?: number;
  } = {},
): Promise<{ comments: AdminComment[]; total: number }> {
  const query = new URLSearchParams();
  if (params.status) query.set("status", params.status);
  if (params.postId) query.set("postId", params.postId);
  if (params.limit) query.set("limit", String(params.limit));
  if (params.offset) query.set("offset", String(params.offset));
  return apiRequest(`/comments?${query.toString()}`);
}

export async function hideCommentApi(
  id: string,
): Promise<{ comment: { id: string; status: string } }> {
  return apiRequest(`/comments/${id}/hide`, { method: "POST" });
}

export async function restoreCommentApi(
  id: string,
): Promise<{ comment: { id: string; status: string } }> {
  return apiRequest(`/comments/${id}/restore`, { method: "POST" });
}

export async function adminDeleteCommentApi(
  id: string,
): Promise<{ comment: { id: string; status: string } }> {
  return apiRequest(`/comments/${id}/delete`, { method: "POST" });
}

export async function listCommentReportsApi(
  params: { status?: string; limit?: number; offset?: number } = {},
): Promise<{ reports: AdminCommentReport[]; total: number }> {
  const query = new URLSearchParams();
  if (params.status) query.set("status", params.status);
  if (params.limit) query.set("limit", String(params.limit));
  if (params.offset) query.set("offset", String(params.offset));
  return apiRequest(`/comment-reports?${query.toString()}`);
}

export async function resolveCommentReportApi(
  id: string,
  action: string,
): Promise<{ success: boolean }> {
  return apiRequest(`/comment-reports/${id}/resolve`, {
    method: "POST",
    body: JSON.stringify({ action }),
  });
}
