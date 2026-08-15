import {
  Recommendation,
  CreateRecommendationData,
  UpdateRecommendationData,
} from "./recommendation";

export interface RecommendationRepository {
  create(data: CreateRecommendationData): Promise<Recommendation>;
  findById(id: string): Promise<Recommendation | null>;
  update(id: string, data: UpdateRecommendationData): Promise<Recommendation>;
  archive(id: string): Promise<Recommendation>;
  list(filter?: { includeArchived?: boolean }): Promise<Recommendation[]>;
  listActive(): Promise<Recommendation[]>;
}

export interface RecommendationEventRepository {
  record(data: {
    recommendationId: string;
    memberId?: string | null;
    type: string;
    sessionId?: string | null;
  }): Promise<void>;
  countByType(recommendationId: string): Promise<Record<string, number>>;
}
