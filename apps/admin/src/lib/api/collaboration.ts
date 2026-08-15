import { apiRequest } from "./client";

export interface EditorialComment {
  id: string;
  postId: string;
  authorId: string;
  authorName: string;
  body: string;
  blockId?: string | null | undefined;
  status: "open" | "resolved";
  resolvedBy?: string | null | undefined;
  resolvedAt?: string | null | undefined;
  createdAt: string;
}

export interface EditorialSuggestion {
  id: string;
  postId: string;
  authorId: string;
  authorName: string;
  originalText: string;
  suggestedText: string;
  blockId?: string | null | undefined;
  status: "pending" | "accepted" | "rejected";
  reviewedBy?: string | null | undefined;
  reviewedAt?: string | null | undefined;
  createdAt: string;
}

export interface EditorialAssignment {
  id: string;
  postId: string;
  assigneeId?: string | null | undefined;
  assigneeName?: string | null | undefined;
  reviewerIds: string[];
  dueDate?: string | null | undefined;
  editorialNotes?: string | null | undefined;
  reviewStatus: "pending" | "in_review" | "changes_requested" | "approved";
  updatedAt: string;
}

export interface PresenceUser {
  userId: string;
  name: string;
  cursor?: { x: number; y: number; blockId?: string } | undefined;
  lastActive: number;
}

export async function fetchEditorialComments(
  postId: string,
): Promise<EditorialComment[]> {
  const res = await apiRequest<{ data: EditorialComment[] }>(
    `/posts/${postId}/collaboration/comments`,
  );
  return res.data;
}

export async function addEditorialComment(
  postId: string,
  body: string,
  blockId?: string,
): Promise<EditorialComment> {
  const res = await apiRequest<{ data: EditorialComment }>(
    `/posts/${postId}/collaboration/comments`,
    {
      method: "POST",
      body: JSON.stringify({ body, blockId }),
    },
  );
  return res.data;
}

export async function resolveEditorialComment(
  postId: string,
  commentId: string,
): Promise<void> {
  await apiRequest(`/posts/${postId}/collaboration/comments/${commentId}/resolve`, {
    method: "POST",
  });
}

export async function fetchEditorialSuggestions(
  postId: string,
): Promise<EditorialSuggestion[]> {
  const res = await apiRequest<{ data: EditorialSuggestion[] }>(
    `/posts/${postId}/collaboration/suggestions`,
  );
  return res.data;
}

export async function createEditorialSuggestion(params: {
  postId: string;
  originalText: string;
  suggestedText: string;
  blockId?: string;
}): Promise<EditorialSuggestion> {
  const res = await apiRequest<{ data: EditorialSuggestion }>(
    `/posts/${params.postId}/collaboration/suggestions`,
    {
      method: "POST",
      body: JSON.stringify(params),
    },
  );
  return res.data;
}

export async function reviewEditorialSuggestion(
  postId: string,
  suggestionId: string,
  action: "accept" | "reject",
): Promise<void> {
  await apiRequest(
    `/posts/${postId}/collaboration/suggestions/${suggestionId}/${action}`,
    {
      method: "POST",
    },
  );
}

export async function fetchEditorialAssignment(
  postId: string,
): Promise<EditorialAssignment | null> {
  const res = await apiRequest<{ data: EditorialAssignment | null }>(
    `/posts/${postId}/collaboration/assignment`,
  );
  return res.data;
}

export async function updateEditorialAssignment(
  postId: string,
  data: Partial<EditorialAssignment>,
): Promise<EditorialAssignment> {
  const res = await apiRequest<{ data: EditorialAssignment }>(
    `/posts/${postId}/collaboration/assignment`,
    {
      method: "PUT",
      body: JSON.stringify(data),
    },
  );
  return res.data;
}

export async function sendPresenceHeartbeat(
  postId: string,
  cursor?: { x: number; y: number; blockId?: string },
): Promise<PresenceUser[]> {
  const res = await apiRequest<{ data: PresenceUser[] }>(
    `/posts/${postId}/collaboration/presence`,
    {
      method: "POST",
      body: JSON.stringify({ cursor }),
    },
  );
  return res.data;
}

export async function transitionPostWorkflow(
  postId: string,
  targetStatus: string,
): Promise<{ status: string }> {
  const res = await apiRequest<{ data: { status: string } }>(
    `/posts/${postId}/workflow/transition`,
    {
      method: "POST",
      body: JSON.stringify({ targetStatus }),
    },
  );
  return res.data;
}
