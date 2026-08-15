import { describe, it, expect, vi } from "vitest";
import {
  PlansService,
  PlanDomainError,
} from "../src/application/plans-service";
import { PlanRepository } from "../src/domain/repository";
import { Plan } from "../src/domain/plan";
import { isValidCurrency, isValidBillingInterval } from "../src/domain/plan";

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: "plan-1",
    productId: "product-1",
    key: "monthly",
    name: "Monthly",
    description: null,
    billingType: "recurring",
    billingInterval: "month",
    intervalCount: 1,
    currency: "USD",
    amountMinor: 1000,
    trialDays: 0,
    status: "active",
    visibility: "public",
    createdAt: new Date(),
    updatedAt: new Date(),
    archivedAt: null,
    ...overrides,
  };
}

describe("money and currency validation", () => {
  it("accepts valid ISO currency codes", () => {
    expect(isValidCurrency("USD")).toBe(true);
    expect(isValidCurrency("SAR")).toBe(true);
    expect(isValidCurrency("EUR")).toBe(true);
    expect(isValidCurrency("GBP")).toBe(true);
  });

  it("rejects invalid currency codes", () => {
    expect(isValidCurrency("usd")).toBe(false);
    expect(isValidCurrency("US")).toBe(false);
    expect(isValidCurrency("USDD")).toBe(false);
    expect(isValidCurrency("")).toBe(false);
  });

  it("accepts month/year intervals and rejects others", () => {
    expect(isValidBillingInterval("month")).toBe(true);
    expect(isValidBillingInterval("year")).toBe(true);
    expect(isValidBillingInterval("week")).toBe(false);
    expect(isValidBillingInterval(null)).toBe(true); // free plans
  });
});

describe("PlansService", () => {
  const repo: PlanRepository = {
    create: vi.fn(async (d) =>
      makePlan({
        key: d.key,
        billingType: d.billingType || "recurring",
        billingInterval: d.billingInterval || null,
        amountMinor: d.amountMinor || 0,
        currency: d.currency || "USD",
      }),
    ),
    findById: vi.fn(async () => null),
    findByKey: vi.fn(async () => null),
    update: vi.fn(async (id) => makePlan()),
    archive: vi.fn(async (id) =>
      makePlan({ status: "archived", archivedAt: new Date() }),
    ),
    listByProduct: vi.fn(async () => []),
    listActivePublic: vi.fn(async () => []),
  };
  const service = new PlansService(repo, async () => true);

  it("creates a valid recurring monthly plan with minor-unit amount", async () => {
    const plan = await service.createPlan(
      {
        productId: "product-1",
        key: "monthly",
        name: "Monthly",
        billingType: "recurring",
        billingInterval: "month",
        intervalCount: 1,
        currency: "usd", // lowercase should be normalized
        amountMinor: 1000,
      },
      null,
    );
    expect(plan.currency).toBe("USD");
    expect(plan.amountMinor).toBe(1000);
  });

  it("creates a free plan with zero amount and no interval", async () => {
    const plan = await service.createPlan(
      {
        productId: "product-1",
        key: "free",
        name: "Free",
        billingType: "free",
      },
      null,
    );
    expect(plan.billingType).toBe("free");
    expect(plan.amountMinor).toBe(0);
    expect(plan.billingInterval).toBeNull();
  });

  it("rejects an invalid billing interval", async () => {
    await expect(
      service.createPlan(
        {
          productId: "product-1",
          key: "weekly",
          name: "Weekly",
          billingInterval: "week",
          amountMinor: 500,
          currency: "USD",
        },
        null,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects a negative amount", async () => {
    await expect(
      service.createPlan(
        {
          productId: "product-1",
          key: "neg",
          name: "Neg",
          billingInterval: "month",
          amountMinor: -5,
          currency: "USD",
        },
        null,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects trial days over the maximum bound", async () => {
    await expect(
      service.createPlan(
        {
          productId: "product-1",
          key: "trial",
          name: "Trial",
          billingInterval: "month",
          amountMinor: 500,
          currency: "USD",
          trialDays: 500,
        },
        null,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects a plan for a missing product", async () => {
    const missing = new PlansService(repo, async () => false);
    await expect(
      missing.createPlan(
        {
          productId: "nope",
          key: "x",
          name: "X",
          billingInterval: "month",
          amountMinor: 500,
          currency: "USD",
        },
        null,
      ),
    ).rejects.toMatchObject({ code: "PRODUCT_NOT_FOUND" });
  });

  it("rejects a duplicate plan key within a product", async () => {
    const dupRepo: PlanRepository = {
      ...repo,
      findByKey: vi.fn(async () => makePlan()),
    };
    const dupService = new PlansService(dupRepo, async () => true);
    await expect(
      dupService.createPlan(
        {
          productId: "product-1",
          key: "monthly",
          name: "Monthly",
          billingInterval: "month",
          amountMinor: 1000,
          currency: "USD",
        },
        null,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("archives plans (soft delete)", async () => {
    const archivingRepo: PlanRepository = {
      ...repo,
      findById: vi.fn(async () => makePlan()),
    };
    const archivingService = new PlansService(archivingRepo, async () => true);
    const archived = await archivingService.archivePlan("plan-1", "user-1");
    expect(archived.status).toBe("archived");
  });
});
