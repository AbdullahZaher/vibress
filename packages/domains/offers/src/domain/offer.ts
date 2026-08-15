export type OfferDiscountType = "percentage" | "fixed_amount";
export type OfferDurationType = "once" | "repeating" | "forever";
export type OfferStatus = "active" | "disabled";

export interface Offer {
  id: string;
  productId: string;
  planId: string | null;
  key: string;
  name: string;
  description: string | null;
  discountType: OfferDiscountType;
  discountValue: number;
  durationType: OfferDurationType;
  durationCycles: number | null;
  startsAt: Date | null;
  endsAt: Date | null;
  maxRedemptions: number | null;
  redemptionCount: number;
  status: OfferStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateOfferData {
  id?: string | undefined;
  productId: string;
  planId?: string | null | undefined;
  key: string;
  name: string;
  description?: string | null | undefined;
  discountType: OfferDiscountType;
  discountValue: number;
  durationType?: OfferDurationType | undefined;
  durationCycles?: number | null | undefined;
  startsAt?: Date | null | undefined;
  endsAt?: Date | null | undefined;
  maxRedemptions?: number | null | undefined;
  status?: OfferStatus | undefined;
}

export interface UpdateOfferData {
  name?: string | undefined;
  description?: string | null | undefined;
  status?: OfferStatus | undefined;
  maxRedemptions?: number | null | undefined;
  startsAt?: Date | null | undefined;
  endsAt?: Date | null | undefined;
}
