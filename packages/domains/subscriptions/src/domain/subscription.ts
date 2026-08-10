export type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'unpaid'
  | 'cancelled'
  | 'expired'
  | 'incomplete';

export const ACCESS_GRANTING_STATUSES: SubscriptionStatus[] = ['trialing', 'active'];

export interface Subscription {
  id: string;
  memberId: string;
  productId: string;
  planId: string;
  provider: string | null;
  providerSubscriptionId: string | null;
  providerCustomerId: string | null;
  status: SubscriptionStatus;
  currency: string;
  amountMinor: number;
  billingInterval: string;
  intervalCount: number;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  trialStart: Date | null;
  trialEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  cancelledAt: Date | null;
  endedAt: Date | null;
  offerId: string | null;
  providerEventTimestamp: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateSubscriptionData {
  id?: string | undefined;
  memberId: string;
  productId: string;
  planId: string;
  provider?: string | null | undefined;
  providerSubscriptionId?: string | null | undefined;
  providerCustomerId?: string | null | undefined;
  status: SubscriptionStatus;
  currency: string;
  amountMinor: number;
  billingInterval: string;
  intervalCount?: number | undefined;
  currentPeriodStart?: Date | null | undefined;
  currentPeriodEnd?: Date | null | undefined;
  trialStart?: Date | null | undefined;
  trialEnd?: Date | null | undefined;
  cancelAtPeriodEnd?: boolean | undefined;
  offerId?: string | null | undefined;
  providerEventTimestamp?: Date | null | undefined;
}

export interface UpdateSubscriptionData {
  status?: SubscriptionStatus | undefined;
  providerSubscriptionId?: string | null | undefined;
  providerCustomerId?: string | null | undefined;
  currentPeriodStart?: Date | null | undefined;
  currentPeriodEnd?: Date | null | undefined;
  trialStart?: Date | null | undefined;
  trialEnd?: Date | null | undefined;
  cancelAtPeriodEnd?: boolean | undefined;
  cancelledAt?: Date | null | undefined;
  endedAt?: Date | null | undefined;
  providerEventTimestamp?: Date | null | undefined;
}

export interface ListSubscriptionsFilter {
  memberId?: string | undefined;
  status?: SubscriptionStatus | undefined;
  productId?: string | undefined;
  planId?: string | undefined;
  search?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}
