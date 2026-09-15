import { Plan, CreatePlanData, UpdatePlanData, PlanStatus } from "./plan";

export interface PlanRepository {
  create(data: CreatePlanData & { publicationId?: string }): Promise<Plan>;
  findById(id: string, publicationId?: string): Promise<Plan | null>;
  findByKey(productId: string, key: string, publicationId?: string): Promise<Plan | null>;
  update(id: string, data: UpdatePlanData, publicationId?: string): Promise<Plan>;
  archive(id: string, publicationId?: string): Promise<Plan>;
  listByProduct(
    productId: string,
    filter?: { status?: PlanStatus; includeArchived?: boolean },
    publicationId?: string,
  ): Promise<Plan[]>;
  listActivePublic(publicationId?: string): Promise<Plan[]>;
}
