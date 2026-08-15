import { apiRequest } from "./client";

export interface AdminProduct {
  id: string;
  key: string;
  name: string;
  description: string | null;
  status: string;
  visibility: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface AdminPlan {
  id: string;
  productId: string;
  key: string;
  name: string;
  description: string | null;
  billingType: string;
  billingInterval: string | null;
  intervalCount: number;
  currency: string;
  amountMinor: number;
  trialDays: number;
  status: string;
  visibility: string;
  archivedAt: string | null;
}

export interface AdminOffer {
  id: string;
  productId: string;
  planId: string | null;
  key: string;
  name: string;
  description: string | null;
  discountType: string;
  discountValue: number;
  durationType: string;
  durationCycles: number | null;
  startsAt: string | null;
  endsAt: string | null;
  maxRedemptions: number | null;
  redemptionCount: number;
  status: string;
}

export interface AdminSubscription {
  id: string;
  memberId: string;
  productId: string;
  planId: string;
  status: string;
  currency: string;
  amountMinor: number;
  billingInterval: string;
  intervalCount: number;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  createdAt: string;
}

export async function listProductsApi(
  includeArchived = false,
): Promise<{ products: AdminProduct[] }> {
  return apiRequest(`/products?includeArchived=${includeArchived}`);
}

export async function createProductApi(data: {
  key: string;
  name: string;
  description?: string | null;
}): Promise<{ product: AdminProduct }> {
  return apiRequest("/products", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function archiveProductApi(
  id: string,
): Promise<{ product: AdminProduct }> {
  return apiRequest(`/products/${id}/archive`, { method: "POST" });
}

export async function listPlansApi(
  productId: string,
): Promise<{ plans: AdminPlan[] }> {
  return apiRequest(`/plans?productId=${encodeURIComponent(productId)}`);
}

export async function createPlanApi(data: {
  productId: string;
  key: string;
  name: string;
  billingType: "free" | "recurring";
  billingInterval?: "month" | "year" | null;
  currency?: string;
  amountMinor?: number;
  trialDays?: number;
}): Promise<{ plan: AdminPlan }> {
  return apiRequest("/plans", { method: "POST", body: JSON.stringify(data) });
}

export async function archivePlanApi(id: string): Promise<{ plan: AdminPlan }> {
  return apiRequest(`/plans/${id}/archive`, { method: "POST" });
}

export async function listOffersApi(): Promise<{ offers: AdminOffer[] }> {
  return apiRequest("/offers");
}

export async function createOfferApi(data: {
  productId: string;
  planId?: string | null;
  key: string;
  name: string;
  discountType: "percentage" | "fixed_amount";
  discountValue: number;
  durationType?: string;
  maxRedemptions?: number | null;
  startsAt?: string | null;
  endsAt?: string | null;
}): Promise<{ offer: AdminOffer }> {
  return apiRequest("/offers", { method: "POST", body: JSON.stringify(data) });
}

export async function disableOfferApi(
  id: string,
): Promise<{ offer: AdminOffer }> {
  return apiRequest(`/offers/${id}/disable`, { method: "POST" });
}

export async function listSubscriptionsApi(
  params: {
    status?: string;
    productId?: string;
    memberId?: string;
    limit?: number;
    offset?: number;
  } = {},
): Promise<{ subscriptions: AdminSubscription[]; total: number }> {
  const query = new URLSearchParams();
  if (params.status) query.set("status", params.status);
  if (params.productId) query.set("productId", params.productId);
  if (params.memberId) query.set("memberId", params.memberId);
  if (params.limit) query.set("limit", String(params.limit));
  if (params.offset) query.set("offset", String(params.offset));
  return apiRequest(`/subscriptions?${query.toString()}`);
}

export async function getSubscriptionApi(
  id: string,
): Promise<{ subscription: AdminSubscription; events: unknown[] }> {
  return apiRequest(`/subscriptions/${id}`);
}

export async function cancelSubscriptionApi(
  id: string,
): Promise<{ subscription: AdminSubscription }> {
  return apiRequest(`/subscriptions/${id}/cancel`, { method: "POST" });
}

export async function listMemberSubscriptionsApi(
  memberId: string,
): Promise<{ subscriptions: AdminSubscription[]; total: number }> {
  return apiRequest(`/members/${memberId}/subscriptions`);
}
