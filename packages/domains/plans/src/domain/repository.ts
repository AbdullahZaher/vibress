import { Plan, CreatePlanData, UpdatePlanData, PlanStatus } from './plan';

export interface PlanRepository {
  create(data: CreatePlanData): Promise<Plan>;
  findById(id: string): Promise<Plan | null>;
  findByKey(productId: string, key: string): Promise<Plan | null>;
  update(id: string, data: UpdatePlanData): Promise<Plan>;
  archive(id: string): Promise<Plan>;
  listByProduct(productId: string, filter?: { status?: PlanStatus; includeArchived?: boolean }): Promise<Plan[]>;
  listActivePublic(): Promise<Plan[]>;
}
