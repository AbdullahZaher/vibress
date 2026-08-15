import { describe, it, expect, vi } from "vitest";
import {
  SubscriptionsService,
  SubscriptionDomainError,
} from "../src/application/subscriptions-service";
import { SubscriptionRepository } from "../src/domain/repository";
import { Subscription } from "../src/domain/subscription";

function makeSubscription(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: "sub-1",
    memberId: "member-1",
    productId: "product-1",
    planId: "plan-1",
    provider: "stripe",
    providerSubscriptionId: "sub_provider_1",
    providerCustomerId: "cus_1",
    status: "active",
    currency: "USD",
    amountMinor: 1000,
    billingInterval: "month",
    intervalCount: 1,
    currentPeriodStart: new Date(),
    currentPeriodEnd: new Date(Date.now() + 2592000000),
    trialStart: null,
    trialEnd: null,
    cancelAtPeriodEnd: false,
    cancelledAt: null,
    endedAt: null,
    offerId: null,
    providerEventTimestamp: new Date("2026-01-01"),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("SubscriptionsService", () => {
  const repo: SubscriptionRepository = {
    create: vi.fn(async (d) => makeSubscription({ ...d, id: "sub-new" })),
    findById: vi.fn(async (id) => makeSubscription({ id })),
    findByProviderSubscriptionId: vi.fn(async () => null),
    update: vi.fn(async (id, d) =>
      makeSubscription({ id, ...(d as Record<string, unknown>) }),
    ),
    list: vi.fn(async () => ({ subscriptions: [], total: 0 })),
    findActiveForMember: vi.fn(async () => null),
    hasActiveForMember: vi.fn(async () => false),
  };
  const service = new SubscriptionsService(repo);

  it("prevents duplicate active subscriptions for the same member+product", async () => {
    const dupRepo: SubscriptionRepository = {
      ...repo,
      findActiveForMember: vi.fn(async () => makeSubscription()),
    };
    const dupService = new SubscriptionsService(dupRepo);
    await expect(
      dupService.createSubscription({
        memberId: "member-1",
        productId: "product-1",
        planId: "plan-2",
        status: "active",
        currency: "USD",
        amountMinor: 2000,
        billingInterval: "month",
      }),
    ).rejects.toMatchObject({ code: "SUBSCRIPTION_ALREADY_ACTIVE" });
  });

  it("allows creating a subscription when no active one exists", async () => {
    const sub = await service.createSubscription({
      memberId: "member-1",
      productId: "product-1",
      planId: "plan-1",
      status: "active",
      currency: "USD",
      amountMinor: 1000,
      billingInterval: "month",
    });
    expect(sub.id).toBe("sub-new");
  });

  it("ignores out-of-order provider events (older timestamps)", async () => {
    const current = makeSubscription({
      providerEventTimestamp: new Date("2026-06-10"),
    });
    const outOfOrderRepo: SubscriptionRepository = {
      ...repo,
      findById: vi.fn(async () => current),
    };
    const s = new SubscriptionsService(outOfOrderRepo);
    const result = await s.applyProviderUpdate(
      "sub-1",
      { status: "cancelled" },
      new Date("2026-06-01"),
    );
    expect(result.status).toBe("active"); // unchanged
    expect(outOfOrderRepo.update).not.toHaveBeenCalled();
  });

  it("applies newer provider events", async () => {
    const current = makeSubscription({
      providerEventTimestamp: new Date("2026-06-01"),
    });
    const newerRepo: SubscriptionRepository = {
      ...repo,
      findById: vi.fn(async () => current),
      update: vi.fn(async (id, d) =>
        makeSubscription({ ...(d as Record<string, unknown>), id }),
      ),
    };
    const s = new SubscriptionsService(newerRepo);
    const result = await s.applyProviderUpdate(
      "sub-1",
      { status: "cancelled" },
      new Date("2026-06-10"),
    );
    expect(result.status).toBe("cancelled");
    expect(newerRepo.update).toHaveBeenCalled();
  });

  it("schedules cancellation at period end (non-destructive)", async () => {
    const result = await service.cancelAtPeriodEnd("sub-1");
    expect(result.cancelAtPeriodEnd).toBe(true);
  });

  it("rejects cancellation of an already-cancelled subscription", async () => {
    const cancelledRepo: SubscriptionRepository = {
      ...repo,
      findById: vi.fn(async () => makeSubscription({ status: "cancelled" })),
    };
    const s = new SubscriptionsService(cancelledRepo);
    await expect(s.cancelAtPeriodEnd("sub-1")).rejects.toMatchObject({
      code: "SUBSCRIPTION_NOT_CANCELLABLE",
    });
  });

  it("resumes a scheduled cancellation", async () => {
    const scheduledRepo: SubscriptionRepository = {
      ...repo,
      findById: vi.fn(async () =>
        makeSubscription({ cancelAtPeriodEnd: true }),
      ),
    };
    const s = new SubscriptionsService(scheduledRepo);
    const result = await s.resume("sub-1");
    expect(result.cancelAtPeriodEnd).toBe(false);
  });

  it("rejects resume when not scheduled for cancellation", async () => {
    await expect(service.resume("sub-1")).rejects.toMatchObject({
      code: "SUBSCRIPTION_NOT_RESUMABLE",
    });
  });

  it("rejects resume of a cancelled subscription", async () => {
    const cancelledRepo: SubscriptionRepository = {
      ...repo,
      findById: vi.fn(async () =>
        makeSubscription({ status: "cancelled", cancelAtPeriodEnd: true }),
      ),
    };
    const s = new SubscriptionsService(cancelledRepo);
    await expect(s.resume("sub-1")).rejects.toMatchObject({
      code: "SUBSCRIPTION_NOT_RESUMABLE",
    });
  });

  it("access policy: trialing and active grant access; past_due does not", () => {
    expect(service.hasAccess(makeSubscription({ status: "trialing" }))).toBe(
      true,
    );
    expect(service.hasAccess(makeSubscription({ status: "active" }))).toBe(
      true,
    );
    expect(service.hasAccess(makeSubscription({ status: "past_due" }))).toBe(
      false,
    );
    expect(service.hasAccess(makeSubscription({ status: "unpaid" }))).toBe(
      false,
    );
    expect(service.hasAccess(makeSubscription({ status: "cancelled" }))).toBe(
      false,
    );
    expect(service.hasAccess(makeSubscription({ status: "expired" }))).toBe(
      false,
    );
    expect(service.hasAccess(makeSubscription({ status: "incomplete" }))).toBe(
      false,
    );
  });
});
