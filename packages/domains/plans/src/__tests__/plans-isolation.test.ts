import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import { getDb, publications, products, plans } from "@vibress/database";
import { inArray } from "drizzle-orm";
import { DrizzlePlanRepository } from "../infrastructure/drizzle-plan-repository";
import { PlansService, PlanDomainError } from "../application/plans-service";

describe("Plans Multi-Publication Isolation", () => {
  let planRepo: DrizzlePlanRepository;
  let plansService: PlansService;
  let prodAlphaId: string;
  let prodBetaId: string;

  beforeAll(async () => {
    const db = getDb();
    await db
      .insert(publications)
      .values([
        {
          id: "pub_alpha",
          workspaceId: "ws_default",
          name: "Alpha Pub",
          slug: "alpha",
          primaryLocale: "en",
        },
        {
          id: "pub_beta",
          workspaceId: "ws_default",
          name: "Beta Pub",
          slug: "beta",
          primaryLocale: "en",
        },
      ])
      .onConflictDoNothing();

    prodAlphaId = "prod_test_alpha_1";
    prodBetaId = "prod_test_beta_1";

    await db
      .insert(products)
      .values([
        {
          id: prodAlphaId,
          publicationId: "pub_alpha",
          key: "prod-alpha",
          name: "Prod Alpha",
          status: "active",
        },
        {
          id: prodBetaId,
          publicationId: "pub_beta",
          key: "prod-beta",
          name: "Prod Beta",
          status: "active",
        },
      ])
      .onConflictDoNothing();
  });

  beforeEach(async () => {
    const db = getDb();
    await db.delete(plans).where(inArray(plans.publicationId, ["pub_alpha", "pub_beta"]));

    planRepo = new DrizzlePlanRepository();
    plansService = new PlansService(
      planRepo,
      async (productId: string, pubId?: string) => {
        if (productId === prodAlphaId) return pubId === "pub_alpha";
        if (productId === prodBetaId) return pubId === "pub_beta";
        return false;
      },
    );
  });

  it("prevents creating plans referencing products in other publications", async () => {
    // Attempting to create plan for prodAlpha under pub_beta
    await expect(
      plansService.createPlan(
        {
          productId: prodAlphaId,
          key: "cross-plan",
          name: "Cross Plan",
          billingType: "recurring",
          billingInterval: "month",
          amountMinor: 1000,
        },
        "attacker",
        "pub_beta",
      ),
    ).rejects.toThrow(PlanDomainError);
  });

  it("permits identical plan keys under same product interval within separate publications", async () => {
    const planAlpha = await plansService.createPlan(
      {
        productId: prodAlphaId,
        key: "pro-annual",
        name: "Pro Annual Alpha",
        billingType: "recurring",
        billingInterval: "year",
        amountMinor: 10000,
      },
      "staff_1",
      "pub_alpha",
    );

    const planBeta = await plansService.createPlan(
      {
        productId: prodBetaId,
        key: "pro-annual",
        name: "Pro Annual Beta",
        billingType: "recurring",
        billingInterval: "year",
        amountMinor: 10000,
      },
      "staff_2",
      "pub_beta",
    );

    expect(planAlpha.publicationId).toBe("pub_alpha");
    expect(planBeta.publicationId).toBe("pub_beta");
    expect(planAlpha.key).toBe("pro-annual");
    expect(planBeta.key).toBe("pro-annual");
    expect(planAlpha.id).not.toBe(planBeta.id);

    // Cross-publication read isolation
    const readFromB = await plansService.getPlan(planAlpha.id, "pub_beta");
    expect(readFromB).toBeNull();
  });
});
