import { describe, it, expect, vi } from "vitest";
import {
  OffersService,
  OfferDomainError,
} from "../src/application/offers-service";
import { OfferRepository } from "../src/domain/repository";
import { Offer } from "../src/domain/offer";

function makeOffer(overrides: Partial<Offer> = {}): Offer {
  return {
    id: "offer-1",
    productId: "product-1",
    planId: null,
    key: "LAUNCH20",
    name: "Launch 20%",
    description: null,
    discountType: "percentage",
    discountValue: 20,
    durationType: "once",
    durationCycles: null,
    startsAt: null,
    endsAt: null,
    maxRedemptions: null,
    redemptionCount: 0,
    status: "active",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("OffersService", () => {
  const repo: OfferRepository = {
    create: vi.fn(async (d) =>
      makeOffer({
        key: d.key,
        discountType: d.discountType,
        discountValue: d.discountValue,
      }),
    ),
    findById: vi.fn(async () => null),
    findByKey: vi.fn(async () => null),
    update: vi.fn(async (id) => makeOffer()),
    list: vi.fn(async () => []),
    incrementRedemption: vi.fn(async () => true),
  };
  const service = new OffersService(
    repo,
    async () => true,
    async () => true,
  );

  it("creates a valid percentage offer", async () => {
    const offer = await service.createOffer(
      {
        productId: "product-1",
        key: "SAVE10",
        name: "Save 10",
        discountType: "percentage",
        discountValue: 10,
      },
      null,
    );
    expect(offer.discountType).toBe("percentage");
    expect(offer.discountValue).toBe(10);
  });

  it("rejects percentage above 100", async () => {
    await expect(
      service.createOffer(
        {
          productId: "product-1",
          key: "BAD",
          name: "Bad",
          discountType: "percentage",
          discountValue: 101,
        },
        null,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects non-integer percentage", async () => {
    await expect(
      service.createOffer(
        {
          productId: "product-1",
          key: "BAD2",
          name: "Bad2",
          discountType: "percentage",
          discountValue: 12.5,
        },
        null,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects negative fixed discount", async () => {
    await expect(
      service.createOffer(
        {
          productId: "product-1",
          key: "NEG",
          name: "Neg",
          discountType: "fixed_amount",
          discountValue: -1,
        },
        null,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects start after end", async () => {
    await expect(
      service.createOffer(
        {
          productId: "product-1",
          key: "WINDOW",
          name: "Window",
          discountType: "percentage",
          discountValue: 10,
          startsAt: new Date("2026-02-01"),
          endsAt: new Date("2026-01-01"),
        },
        null,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("validates an offer only when active and within window", async () => {
    const now = new Date("2026-06-01");
    await expect(
      service.validateOffer(makeOffer(), "plan-1", now),
    ).resolves.toBeUndefined();

    await expect(
      service.validateOffer(makeOffer({ status: "disabled" }), "plan-1", now),
    ).rejects.toMatchObject({ code: "OFFER_INVALID" });

    await expect(
      service.validateOffer(
        makeOffer({ startsAt: new Date("2026-07-01") }),
        "plan-1",
        now,
      ),
    ).rejects.toMatchObject({ code: "OFFER_INVALID" });

    await expect(
      service.validateOffer(
        makeOffer({ endsAt: new Date("2026-01-01") }),
        "plan-1",
        now,
      ),
    ).rejects.toMatchObject({ code: "OFFER_EXPIRED" });

    await expect(
      service.validateOffer(makeOffer({ planId: "plan-9" }), "plan-1", now),
    ).rejects.toMatchObject({ code: "OFFER_INVALID" });
  });

  it("rejects an offer at redemption limit", async () => {
    const now = new Date("2026-06-01");
    const atLimit = makeOffer({ maxRedemptions: 5, redemptionCount: 5 });
    await expect(
      service.validateOffer(atLimit, "plan-1", now),
    ).rejects.toMatchObject({ code: "OFFER_REDEMPTION_LIMIT_REACHED" });
  });

  it("allows offers with unused redemption capacity", async () => {
    const now = new Date("2026-06-01");
    const ok = makeOffer({ maxRedemptions: 5, redemptionCount: 4 });
    await expect(
      service.validateOffer(ok, "plan-1", now),
    ).resolves.toBeUndefined();
  });

  it("delegates atomic redemption to the repository", async () => {
    const redeemed = await service.redeemOffer("offer-1", new Date());
    expect(redeemed).toBe(true);
  });
});
