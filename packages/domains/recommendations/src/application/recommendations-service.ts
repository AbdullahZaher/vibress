import {
  RecommendationRepository,
  RecommendationEventRepository,
} from "../domain/repository";
import {
  Recommendation,
  CreateRecommendationData,
  UpdateRecommendationData,
} from "../domain/recommendation";
import { domainEvents } from "@vibress/events";
import { isSafeUrl } from "@vibress/security";

export class RecommendationDomainError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export class RecommendationsService {
  constructor(
    private repo: RecommendationRepository,
    private eventRepo: RecommendationEventRepository,
  ) {}

  async createRecommendation(
    data: CreateRecommendationData,
    actorId: string | null,
  ): Promise<Recommendation> {
    if (!isSafeUrl(data.url)) {
      throw new RecommendationDomainError(
        "UNSAFE_URL",
        "URL must be http/https and not point to a private/localhost address",
      );
    }
    if (!data.title.trim()) {
      throw new RecommendationDomainError(
        "VALIDATION_ERROR",
        "Title is required",
      );
    }
    if (data.title.length > 200) {
      throw new RecommendationDomainError(
        "VALIDATION_ERROR",
        "Title is too long",
      );
    }
    const recommendation = await this.repo.create(data);
    domainEvents.emit("recommendation.created", {
      recommendationId: recommendation.id,
      actorId,
    });
    return recommendation;
  }

  async updateRecommendation(
    id: string,
    data: UpdateRecommendationData,
    _actorId: string | null,
  ): Promise<Recommendation> {
    const existing = await this.repo.findById(id);
    if (!existing)
      throw new RecommendationDomainError(
        "RECOMMENDATION_NOT_FOUND",
        "Recommendation not found",
      );
    const updated = await this.repo.update(id, data);
    return updated;
  }

  async archiveRecommendation(
    id: string,
    _actorId: string | null,
  ): Promise<Recommendation> {
    const existing = await this.repo.findById(id);
    if (!existing)
      throw new RecommendationDomainError(
        "RECOMMENDATION_NOT_FOUND",
        "Recommendation not found",
      );
    const archived = await this.repo.archive(id);
    return archived;
  }

  async getRecommendation(id: string): Promise<Recommendation | null> {
    return this.repo.findById(id);
  }

  async listRecommendations(filter?: {
    includeArchived?: boolean;
  }): Promise<Recommendation[]> {
    return this.repo.list(filter);
  }

  async listActiveRecommendations(): Promise<Recommendation[]> {
    return this.repo.listActive();
  }

  async recordClick(
    recommendationId: string,
    memberId: string | null,
    sessionId: string | null,
  ): Promise<void> {
    const recommendation = await this.repo.findById(recommendationId);
    if (!recommendation)
      throw new RecommendationDomainError(
        "RECOMMENDATION_NOT_FOUND",
        "Recommendation not found",
      );
    await this.eventRepo.record({
      recommendationId,
      memberId,
      type: "click",
      sessionId,
    });
    domainEvents.emit("recommendation.clicked", { recommendationId, memberId });
  }

  async recordView(
    recommendationId: string,
    sessionId: string | null,
  ): Promise<void> {
    await this.eventRepo.record({ recommendationId, type: "view", sessionId });
  }

  async getClickCount(
    recommendationId: string,
  ): Promise<Record<string, number>> {
    return this.eventRepo.countByType(recommendationId);
  }
}
