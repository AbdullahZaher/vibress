export interface BillingCreateCustomerInput {
  email: string;
  name?: string | null | undefined;
  metadata?: Record<string, string> | undefined;
}

export interface BillingCheckoutInput {
  customerId: string;
  priceId: string;
  successUrl: string;
  cancelUrl: string;
  metadata?: Record<string, string> | undefined;
  allowPromotionCodes?: boolean | undefined;
  subscriptionData?: {
    trialDays?: number | undefined;
    metadata?: Record<string, string> | undefined;
  } | undefined;
}

export interface BillingCheckoutResult {
  url: string;
  checkoutSessionId: string;
}

export interface BillingPortalInput {
  customerId: string;
  returnUrl: string;
}

export interface BillingPortalResult {
  url: string;
}

export interface BillingSubscriptionInfo {
  providerSubscriptionId: string;
  status: string;
  currentPeriodStart: number | null;
  currentPeriodEnd: number | null;
  cancelAtPeriodEnd: boolean;
  cancelAt: number | null;
  trialStart: number | null;
  trialEnd: number | null;
  currency: string;
  amountMinor: number | null;
}

export interface BillingProvider {
  readonly name: string;
  createCustomer(input: BillingCreateCustomerInput): Promise<string>;
  createCheckoutSession(input: BillingCheckoutInput): Promise<BillingCheckoutResult>;
  createBillingPortalSession(input: BillingPortalInput): Promise<BillingPortalResult>;
  getSubscription(providerSubscriptionId: string): Promise<BillingSubscriptionInfo | null>;
  cancelSubscription(providerSubscriptionId: string): Promise<void>;
  verifyWebhookSignature(payload: string | Buffer, signatureHeader: string | null | undefined): Promise<boolean>;
  parseWebhookEvent(payload: string | Buffer): Promise<{
    id: string;
    type: string;
    created: number;
    data: Record<string, unknown>;
  }>;
}
