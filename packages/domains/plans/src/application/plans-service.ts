import { PlanRepository } from '../domain/repository';
import { Plan, CreatePlanData, UpdatePlanData, isValidCurrency, isValidBillingInterval, MAX_TRIAL_DAYS, MAX_AMOUNT_MINOR } from '../domain/plan';
import { domainEvents } from '@vibress/events';

export class PlanDomainError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

const PLAN_KEY_REGEX = /^[a-z0-9][a-z0-9-]*$/;

export class PlansService {
  constructor(private repo: PlanRepository, private productExists: (id: string) => Promise<boolean>) {}

  async createPlan(data: CreatePlanData, actorId: string | null): Promise<Plan> {
    if (!(await this.productExists(data.productId))) {
      throw new PlanDomainError('PRODUCT_NOT_FOUND', 'Product not found');
    }
    const key = data.key.trim().toLowerCase();
    if (!PLAN_KEY_REGEX.test(key)) {
      throw new PlanDomainError('VALIDATION_ERROR', 'Plan key must be lowercase alphanumeric with hyphens');
    }
    const existing = await this.repo.findByKey(data.productId, key);
    if (existing) {
      throw new PlanDomainError('VALIDATION_ERROR', 'Plan key already exists for this product');
    }

    const billingType = data.billingType || 'recurring';
    if (billingType === 'recurring') {
      if (!isValidBillingInterval(data.billingInterval)) {
        throw new PlanDomainError('VALIDATION_ERROR', 'Invalid billing interval');
      }
      const amount = data.amountMinor ?? 0;
      if (!Number.isInteger(amount) || amount < 0 || amount > MAX_AMOUNT_MINOR) {
        throw new PlanDomainError('VALIDATION_ERROR', 'Invalid amount');
      }
      const currency = (data.currency || 'USD').toUpperCase();
      if (!isValidCurrency(currency)) {
        throw new PlanDomainError('VALIDATION_ERROR', 'Invalid currency');
      }
      data = { ...data, currency, amountMinor: amount };
    } else {
      // Free plans have no price
      data = { ...data, currency: 'USD', amountMinor: 0, billingInterval: null };
    }

    const trialDays = data.trialDays ?? 0;
    if (!Number.isInteger(trialDays) || trialDays < 0 || trialDays > MAX_TRIAL_DAYS) {
      throw new PlanDomainError('VALIDATION_ERROR', 'Invalid trial days');
    }
    const intervalCount = data.intervalCount ?? 1;
    if (!Number.isInteger(intervalCount) || intervalCount < 1 || intervalCount > 12) {
      throw new PlanDomainError('VALIDATION_ERROR', 'Invalid interval count');
    }

    const plan = await this.repo.create({ ...data, key, trialDays, intervalCount });
    domainEvents.emit('plan.created', { planId: plan.id, actorId });
    return plan;
  }

  async updatePlan(id: string, data: UpdatePlanData, actorId: string | null): Promise<Plan> {
    const existing = await this.repo.findById(id);
    if (!existing) throw new PlanDomainError('PLAN_NOT_FOUND', 'Plan not found');
    const updated = await this.repo.update(id, data);
    domainEvents.emit('plan.updated', { planId: id, actorId });
    return updated;
  }

  async archivePlan(id: string, actorId: string | null): Promise<Plan> {
    const existing = await this.repo.findById(id);
    if (!existing) throw new PlanDomainError('PLAN_NOT_FOUND', 'Plan not found');
    const archived = await this.repo.archive(id);
    domainEvents.emit('plan.archived', { planId: id, actorId });
    return archived;
  }

  async getPlan(id: string): Promise<Plan | null> {
    return this.repo.findById(id);
  }

  async listPlansByProduct(productId: string): Promise<Plan[]> {
    return this.repo.listByProduct(productId);
  }

  async listActivePublicPlans(): Promise<Plan[]> {
    return this.repo.listActivePublic();
  }
}
