import { z } from "zod";

export const PublicProductDtoSchema = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  description: z.string().nullable(),
});
export type PublicProductDto = z.infer<typeof PublicProductDtoSchema>;

export const PublicPlanDtoSchema = z.object({
  id: z.string(),
  productId: z.string(),
  key: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  billingType: z.enum(["free", "recurring"]),
  billingInterval: z.string().nullable(),
  intervalCount: z.number(),
  currency: z.string(),
  amountMinor: z.number(),
  trialDays: z.number(),
});
export type PublicPlanDto = z.infer<typeof PublicPlanDtoSchema>;

export const MemberCheckoutRequestSchema = z.object({
  planId: z.string().min(1),
  offerKey: z.string().optional(),
});
export type MemberCheckoutRequestInput = z.infer<
  typeof MemberCheckoutRequestSchema
>;

export const MemberCheckoutResponseSchema = z.object({
  checkoutUrl: z.string(),
});
export type MemberCheckoutResponse = z.infer<
  typeof MemberCheckoutResponseSchema
>;

export const MemberBillingPortalResponseSchema = z.object({
  url: z.string(),
});
export type MemberBillingPortalResponse = z.infer<
  typeof MemberBillingPortalResponseSchema
>;

export const MemberSubscriptionDtoSchema = z.object({
  id: z.string(),
  productId: z.string(),
  planId: z.string(),
  planName: z.string(),
  status: z.string(),
  currency: z.string(),
  amountMinor: z.number(),
  billingInterval: z.string(),
  intervalCount: z.number(),
  currentPeriodEnd: z.string().nullable(),
  trialEnd: z.string().nullable(),
  cancelAtPeriodEnd: z.boolean(),
  createdAt: z.string(),
});
export type MemberSubscriptionDto = z.infer<typeof MemberSubscriptionDtoSchema>;

export const AdminProductInputSchema = z.object({
  key: z.string().min(1).max(100),
  name: z.string().min(1).max(100),
  description: z.string().max(500).nullable().optional(),
  visibility: z.enum(["public", "private"]).optional(),
});
export type AdminProductInput = z.infer<typeof AdminProductInputSchema>;

export const AdminPlanInputSchema = z.object({
  productId: z.string().min(1),
  key: z.string().min(1).max(100),
  name: z.string().min(1).max(100),
  description: z.string().max(500).nullable().optional(),
  billingType: z.enum(["free", "recurring"]).optional(),
  billingInterval: z.enum(["month", "year"]).nullable().optional(),
  intervalCount: z.number().int().min(1).max(12).optional(),
  currency: z.string().min(3).max(3).optional(),
  amountMinor: z.number().int().min(0).optional(),
  trialDays: z.number().int().min(0).max(365).optional(),
  visibility: z.enum(["public", "private"]).optional(),
});
export type AdminPlanInput = z.infer<typeof AdminPlanInputSchema>;

export const AdminOfferInputSchema = z.object({
  productId: z.string().min(1),
  planId: z.string().nullable().optional(),
  key: z.string().min(1).max(100),
  name: z.string().min(1).max(100),
  description: z.string().max(500).nullable().optional(),
  discountType: z.enum(["percentage", "fixed_amount"]),
  discountValue: z.number().int().min(0),
  durationType: z.enum(["once", "repeating", "forever"]).optional(),
  durationCycles: z.number().int().min(1).nullable().optional(),
  startsAt: z.string().datetime().nullable().optional(),
  endsAt: z.string().datetime().nullable().optional(),
  maxRedemptions: z.number().int().min(1).nullable().optional(),
});
export type AdminOfferInput = z.infer<typeof AdminOfferInputSchema>;

export const AdminSubscriptionFilterSchema = z.object({
  status: z.string().optional(),
  productId: z.string().optional(),
  planId: z.string().optional(),
  memberId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});
export type AdminSubscriptionFilter = z.infer<
  typeof AdminSubscriptionFilterSchema
>;
