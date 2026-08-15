import { apiRequest } from "./client";

export interface AdminMemberSummary {
  id: string;
  email: string;
  name: string | null;
  status: "active" | "disabled";
  emailVerified: boolean;
  createdAt: string;
  lastSeenAt: string | null;
}

export interface AdminMemberDetail extends AdminMemberSummary {
  emailNormalized: string;
  disabledAt: string | null;
  updatedAt: string;
  activeSessionCount?: number;
}

export async function listMembersApi(
  params: {
    search?: string;
    status?: string;
    limit?: number;
    offset?: number;
  } = {},
): Promise<{ members: AdminMemberSummary[]; total: number }> {
  const query = new URLSearchParams();
  if (params.search) query.set("search", params.search);
  if (params.status) query.set("status", params.status);
  if (params.limit) query.set("limit", String(params.limit));
  if (params.offset) query.set("offset", String(params.offset));
  return apiRequest(`/members?${query.toString()}`);
}

export async function getMemberApi(
  id: string,
): Promise<{ member: AdminMemberDetail }> {
  return apiRequest(`/members/${id}`);
}

export async function disableMemberApi(
  id: string,
): Promise<{ member: { id: string; status: string } }> {
  return apiRequest(`/members/${id}/disable`, { method: "POST" });
}

export async function enableMemberApi(
  id: string,
): Promise<{ member: { id: string; status: string } }> {
  return apiRequest(`/members/${id}/enable`, { method: "POST" });
}

export async function revokeMemberSessionsApi(
  id: string,
): Promise<{ revokedCount: number }> {
  return apiRequest(`/members/${id}/revoke-sessions`, { method: "POST" });
}
