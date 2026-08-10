export type RecommendationStatus = 'active' | 'archived';

export interface Recommendation {
  id: string;
  url: string;
  title: string;
  description: string | null;
  imageUrl: string | null;
  faviconUrl: string | null;
  status: RecommendationStatus;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateRecommendationData {
  id?: string | undefined;
  url: string;
  title: string;
  description?: string | null | undefined;
  imageUrl?: string | null | undefined;
  faviconUrl?: string | null | undefined;
  status?: RecommendationStatus | undefined;
  sortOrder?: number | undefined;
}

export interface UpdateRecommendationData {
  title?: string | undefined;
  description?: string | null | undefined;
  imageUrl?: string | null | undefined;
  faviconUrl?: string | null | undefined;
  status?: RecommendationStatus | undefined;
  sortOrder?: number | undefined;
}

export interface RecommendationEvent {
  id: string;
  recommendationId: string;
  memberId: string | null;
  type: string;
  sessionId: string | null;
  createdAt: Date;
}
