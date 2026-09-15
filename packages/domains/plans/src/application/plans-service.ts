import { PlanRepository } from "../domain/repository";
import {
  Plan,
  CreatePlanData,
  UpdatePlanData,
  isValidCurrency,
  isValidBillingInterval,
  MAX_TRIAL_DAYS,
  MAX_AMOUNT_MINOR,
} from "../domain/plan";
import { domainEvents } from "@vibress/events";

export class PlanDomainError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

const PLAN_KEY_REGEX = /^[a-z0-9][a-z0-9-]*$/;

export class PlansService {
  constructor(
    private repo: PlanRepository,
    private productExists: (id: string, publicationId?: string) => Promise<boolean>,
  ) {}

  async createPlan(
    data: CreatePlanData,
    actorId: string | null,
    publicationId?: string,
  ): Promise<Plan> {
    const pubId = publicationId || data.publicationId || "pub_default";
    if (!(await this.productExists(data.productId, pubId))) {
      throw new PlanDomainError("PRODUCT_NOT_FOUND", "Product not found");
    }
    const key = data.key.trim().toLowerCase();
    if (!PLAN_KEY_REGEX.test(key)) {
      throw new PlanDomainError(
        "VALIDATION_ERROR",
        "Plan key must be lowercase alphanumeric with hyphens",
      );
    }
    const existing = await this.repo.findByKey(data.productId, key, pubId);
    if (existing) {
      throw new PlanDomainError(
        "VALIDATION_ERROR",
        "Plan key already exists for this product",
      );
    }

    const billingType = data.billingType || "recurring";
    if (billingType === "recurring") {
      if (!isValidBillingInterval(data.billingInterval)) {
        throw new PlanDomainError(
          "VALIDATION_ERROR",
          "Invalid billing interval",
        );
      }
      const amount = data.amountMinor ?? 0;
      if (
        !Number.isInteger(amount) ||
        amount < 0 ||
        amount > MAX_AMOUNT_MINOR
      ) {
        throw new PlanDomainError("VALIDATION_ERROR", "Invalid amount");
      }
      const currency = (data.currency || "USD").toUpperCase();
      if (!isValidCurrency(currency)) {
        throw new PlanDomainError("VALIDATION_ERROR", "Invalid currency");
      }
      data = { ...data, currency, amountMinor: amount };
    } else {
      // Free plans have no price
      data = {
        ...data,
        currency: "USD",
        amountMinor: 0,
        billingInterval: null,
      };
    }

    const trialDays = data.trialDays ?? 0;
    if (
      !Number.isInteger(trialDays) ||
      trialDays < 0 ||
      trialDays > MAX_TRIAL_DAYS
    ) {
      throw new PlanDomainError("VALIDATION_ERROR", "Invalid trial days");
    }
    const intervalCount = data.intervalCount ?? 1;
    if (
      !Number.isInteger(intervalCount) ||
      intervalCount < 1 ||
      intervalCount > 12
    ) {
      throw new PlanDomainError("VALIDATION_ERROR", "Invalid interval count");
    }

    const plan = await this.repo.create({
      ...data,
      publicationId: pubId,
      key,
      trialDays,
      intervalCount,
    });
    domainEvents.emit("plan.created", { planId: plan.id, actorId, publicationId: pubId });
    return plan;
  }

  async updatePlan(
    id: string,
    data: UpdatePlanData,
    actorId: string | null,
    publicationId?: string,
  ): Promise<Plan> {
    const existing = await this.repo.findById(id, publicationId);
    if (!existing)
      throw new PlanDomainError("PLAN_NOT_FOUND", "Plan not found");
    const updated = await this.repo.update(id, data, publicationId);
    domainEvents.emit("plan.updated", { planId: id, actorId, publicationId: existing.publicationId });
    return updated;
  }

  async archivePlan(id: string, actorId: string | null, publicationId?: string): Promise<Plan> {
    const existing = await this.repo.findById(id, publicationId);
    if (!existing)
      throw new PlanDomainError("PLAN_NOT_FOUND", "Plan not found");
    const archived = await this.repo.archive(id, publicationId);
    domainEvents.emit("plan.archived", { planId: id, actorId, publicationId: existing.publicationId });
    return archived;
  }

  async getPlan(id: string, publicationId?: string): Promise<Plan | null> {
    return this.repo.findById(id, publicationId);
  }

  async listPlansByProduct(productId: string, publicationId?: string): Promise<Plan[]> {
    return this.repo.listByProduct(productId, undefined, publicationId);
  }

  async listActivePublicPlans(publicationId?: string): Promise<Plan[]> {
    return this.repo.listActivePublic(publicationId);
  }
}
