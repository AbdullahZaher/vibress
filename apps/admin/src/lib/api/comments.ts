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

export interface AdminModerationEvent {
  id: string;
  commentId: string;
  actorId: string;
  actorType: "staff" | "system" | "member";
  action: "approve" | "reject" | "hide" | "restore" | "delete";
  previousStatus: string;
  newStatus: string;
  reason: string | null;
  metadata?: Record<string, unknown> | null;
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

export async function approveCommentApi(
  id: string,
  reason?: string,
): Promise<{ comment: { id: string; status: string } }> {
  return apiRequest(`/comments/${id}/approve`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

export async function rejectCommentApi(
  id: string,
  reason?: string,
): Promise<{ comment: { id: string; status: string } }> {
  return apiRequest(`/comments/${id}/reject`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

export async function hideCommentApi(
  id: string,
  reason?: string,
): Promise<{ comment: { id: string; status: string } }> {
  return apiRequest(`/comments/${id}/hide`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

export async function restoreCommentApi(
  id: string,
  reason?: string,
): Promise<{ comment: { id: string; status: string } }> {
  return apiRequest(`/comments/${id}/restore`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

export async function adminDeleteCommentApi(
  id: string,
  reason?: string,
): Promise<{ comment: { id: string; status: string } }> {
  return apiRequest(`/comments/${id}/delete`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

export async function getCommentModerationHistoryApi(
  id: string,
): Promise<{ events: AdminModerationEvent[] }> {
  return apiRequest(`/comments/${id}/history`);
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
  action: "resolve" | "dismiss" | string,
): Promise<{ success: boolean }> {
  return apiRequest(`/comment-reports/${id}/resolve`, {
    method: "POST",
    body: JSON.stringify({ action }),
  });
}

