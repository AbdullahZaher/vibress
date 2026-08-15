import { apiRequest } from "./client";

export interface AdminRecommendation {
  id: string;
  url: string;
  title: string;
  description: string | null;
  imageUrl: string | null;
  faviconUrl: string | null;
  status: string;
  sortOrder: number;
  createdAt: string;
}

export async function listRecommendationsApi(
  includeArchived = false,
): Promise<{ recommendations: AdminRecommendation[] }> {
  return apiRequest(`/recommendations?includeArchived=${includeArchived}`);
}

export async function createRecommendationApi(data: {
  url: string;
  title: string;
  description?: string | null;
}): Promise<{ recommendation: AdminRecommendation }> {
  return apiRequest("/recommendations", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function archiveRecommendationApi(
  id: string,
): Promise<{ recommendation: AdminRecommendation }> {
  return apiRequest(`/recommendations/${id}/archive`, { method: "POST" });
}
