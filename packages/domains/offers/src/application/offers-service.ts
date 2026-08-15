import { OfferRepository } from "../domain/repository";
import { Offer, CreateOfferData, UpdateOfferData } from "../domain/offer";
import { domainEvents } from "@vibress/events";

export class OfferDomainError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

const OFFER_KEY_REGEX = /^[a-z0-9][a-z0-9-]*$/;

export class OffersService {
  constructor(
    private repo: OfferRepository,
    private productExists: (id: string) => Promise<boolean>,
    private planExists: (id: string) => Promise<boolean>,
  ) {}

  async createOffer(
    data: CreateOfferData,
    actorId: string | null,
  ): Promise<Offer> {
    if (!(await this.productExists(data.productId))) {
      throw new OfferDomainError("PRODUCT_NOT_FOUND", "Product not found");
    }
    if (data.planId && !(await this.planExists(data.planId))) {
      throw new OfferDomainError("PLAN_NOT_FOUND", "Plan not found");
    }

    const key = data.key.trim().toLowerCase();
    if (!OFFER_KEY_REGEX.test(key)) {
      throw new OfferDomainError(
        "VALIDATION_ERROR",
        "Offer key must be lowercase alphanumeric with hyphens",
      );
    }
    const existing = await this.repo.findByKey(key);
    if (existing) {
      throw new OfferDomainError(
        "VALIDATION_ERROR",
        "Offer key already exists",
      );
    }

    this.validateOfferData(data);

    const offer = await this.repo.create({ ...data, key });
    domainEvents.emit("offer.created", { offerId: offer.id, actorId });
    return offer;
  }

  async updateOffer(
    id: string,
    data: UpdateOfferData,
    actorId: string | null,
  ): Promise<Offer> {
    const existing = await this.repo.findById(id);
    if (!existing)
      throw new OfferDomainError("OFFER_NOT_FOUND", "Offer not found");
    const updated = await this.repo.update(id, data);
    domainEvents.emit("offer.updated", { offerId: id, actorId });
    return updated;
  }

  async disableOffer(id: string, actorId: string | null): Promise<Offer> {
    const existing = await this.repo.findById(id);
    if (!existing)
      throw new OfferDomainError("OFFER_NOT_FOUND", "Offer not found");
    const updated = await this.repo.update(id, { status: "disabled" });
    domainEvents.emit("offer.disabled", { offerId: id, actorId });
    return updated;
  }

  async getOffer(id: string): Promise<Offer | null> {
    return this.repo.findById(id);
  }

  async getOfferByKey(key: string): Promise<Offer | null> {
    return this.repo.findByKey(key);
  }

  async listOffers(filter?: {
    status?: "active" | "disabled";
  }): Promise<Offer[]> {
    return this.repo.list(filter);
  }

  /**
   * Validates an offer is currently redeemable. Does NOT increment redemption.
   */
  async validateOffer(offer: Offer, planId: string, now: Date): Promise<void> {
    if (offer.status !== "active") {
      throw new OfferDomainError("OFFER_INVALID", "Offer is not active");
    }
    if (offer.startsAt && offer.startsAt.getTime() > now.getTime()) {
      throw new OfferDomainError("OFFER_INVALID", "Offer has not started");
    }
    if (offer.endsAt && offer.endsAt.getTime() < now.getTime()) {
      throw new OfferDomainError("OFFER_EXPIRED", "Offer has expired");
    }
    if (offer.planId && offer.planId !== planId) {
      throw new OfferDomainError(
        "OFFER_INVALID",
        "Offer does not apply to this plan",
      );
    }
    if (
      offer.maxRedemptions !== null &&
      offer.redemptionCount >= offer.maxRedemptions
    ) {
      throw new OfferDomainError(
        "OFFER_REDEMPTION_LIMIT_REACHED",
        "Offer redemption limit reached",
      );
    }
  }

  /**
   * Atomically increments redemption count; returns false if limit reached.
   */
  async redeemOffer(offerId: string, now: Date): Promise<boolean> {
    return this.repo.incrementRedemption(offerId, now);
  }

  private validateOfferData(data: CreateOfferData): void {
    if (data.discountType === "percentage") {
      if (
        !Number.isInteger(data.discountValue) ||
        data.discountValue <= 0 ||
        data.discountValue > 100
      ) {
        throw new OfferDomainError(
          "VALIDATION_ERROR",
          "Percentage discount must be 1-100",
        );
      }
    } else if (data.discountType === "fixed_amount") {
      if (!Number.isInteger(data.discountValue) || data.discountValue < 0) {
        throw new OfferDomainError(
          "VALIDATION_ERROR",
          "Fixed discount must be non-negative",
        );
      }
    } else {
      throw new OfferDomainError("VALIDATION_ERROR", "Invalid discount type");
    }

    if (
      !["once", "repeating", "forever"].includes(data.durationType || "once")
    ) {
      throw new OfferDomainError("VALIDATION_ERROR", "Invalid duration type");
    }
    if ((data.durationType || "once") === "repeating") {
      const cycles = data.durationCycles ?? 1;
      if (!Number.isInteger(cycles) || cycles < 1) {
        throw new OfferDomainError(
          "VALIDATION_ERROR",
          "Repeating discount requires a positive cycle count",
        );
      }
    }
    if (
      data.startsAt &&
      data.endsAt &&
      data.startsAt.getTime() > data.endsAt.getTime()
    ) {
      throw new OfferDomainError(
        "VALIDATION_ERROR",
        "Offer start must be before end",
      );
    }
    if (data.maxRedemptions !== undefined && data.maxRedemptions !== null) {
      if (!Number.isInteger(data.maxRedemptions) || data.maxRedemptions < 1) {
        throw new OfferDomainError(
          "VALIDATION_ERROR",
          "Max redemptions must be positive",
        );
      }
    }
  }
}
