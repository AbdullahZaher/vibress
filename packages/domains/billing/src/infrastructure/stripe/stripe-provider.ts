import Stripe from 'stripe';
import {
  BillingProvider,
  BillingCreateCustomerInput,
  BillingCheckoutInput,
  BillingCheckoutResult,
  BillingPortalInput,
  BillingPortalResult,
  BillingSubscriptionInfo,
} from '../../domain/provider';

export class StripeBillingError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export interface StripeAdapterOptions {
  secretKey: string;
  webhookSecret: string;
}

export class StripeBillingProvider implements BillingProvider {
  readonly name = 'stripe' as const;
  private stripe: Stripe;
  private webhookSecret: string;

  constructor(options: StripeAdapterOptions) {
    this.stripe = new Stripe(options.secretKey);
    this.webhookSecret = options.webhookSecret;
  }

  async createCustomer(input: BillingCreateCustomerInput): Promise<string> {
    try {
      const params: Stripe.CustomerCreateParams = {};
      if (input.email) params.email = input.email;
      if (input.name) params.name = input.name;
      if (input.metadata) params.metadata = input.metadata;
      const customer = await this.stripe.customers.create(params);
      return customer.id;
    } catch (err) {
      throw this.mapError(err);
    }
  }

  async createCheckoutSession(input: BillingCheckoutInput): Promise<BillingCheckoutResult> {
    try {
      const subscriptionData: Stripe.Checkout.SessionCreateParams.SubscriptionData = {};
      if (input.subscriptionData?.trialDays) {
        subscriptionData.trial_period_days = input.subscriptionData.trialDays;
      }
      if (input.subscriptionData?.metadata) {
        subscriptionData.metadata = input.subscriptionData.metadata;
      }

      const params: Stripe.Checkout.SessionCreateParams = {
        mode: 'subscription',
        customer: input.customerId,
        line_items: [{ price: input.priceId, quantity: 1 }],
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        subscription_data: subscriptionData,
      };
      if (input.allowPromotionCodes) params.allow_promotion_codes = true;
      if (input.metadata) params.metadata = input.metadata;
      const session = await this.stripe.checkout.sessions.create(params);
      return { url: session.url || '', checkoutSessionId: session.id };
    } catch (err) {
      throw this.mapError(err);
    }
  }

  async createBillingPortalSession(input: BillingPortalInput): Promise<BillingPortalResult> {
    try {
      const session = await this.stripe.billingPortal.sessions.create({
        customer: input.customerId,
        return_url: input.returnUrl,
      });
      return { url: session.url };
    } catch (err) {
      throw this.mapError(err);
    }
  }

  async getSubscription(providerSubscriptionId: string): Promise<BillingSubscriptionInfo | null> {
    try {
      const sub = await this.stripe.subscriptions.retrieve(providerSubscriptionId);
      const price = sub.items.data[0]?.price;
      return {
        providerSubscriptionId: sub.id,
        status: sub.status,
        currentPeriodStart: sub.current_period_start || null,
        currentPeriodEnd: sub.current_period_end || null,
        cancelAtPeriodEnd: sub.cancel_at_period_end,
        cancelAt: sub.cancel_at,
        trialStart: sub.trial_start || null,
        trialEnd: sub.trial_end || null,
        currency: sub.currency,
        amountMinor: price && typeof price.unit_amount === 'number' ? price.unit_amount : null,
      };
    } catch (err) {
      throw this.mapError(err);
    }
  }

  async cancelSubscription(providerSubscriptionId: string): Promise<void> {
    try {
      await this.stripe.subscriptions.cancel(providerSubscriptionId);
    } catch (err) {
      throw this.mapError(err);
    }
  }

  async verifyWebhookSignature(payload: string | Buffer, signatureHeader: string | null | undefined): Promise<boolean> {
    if (!signatureHeader) return false;
    try {
      this.stripe.webhooks.constructEvent(payload, signatureHeader, this.webhookSecret);
      return true;
    } catch {
      return false;
    }
  }

  async parseWebhookEvent(payload: string | Buffer): Promise<{ id: string; type: string; created: number; data: Record<string, unknown> }> {
    const event = JSON.parse(payload.toString()) as Stripe.Event;
    return {
      id: event.id,
      type: event.type,
      created: event.created,
      data: (event.data.object as unknown) as Record<string, unknown>,
    };
  }

  private mapError(err: unknown): StripeBillingError {
    if (err instanceof Stripe.errors.StripeConnectionError) {
      return new StripeBillingError('BILLING_PROVIDER_UNAVAILABLE', 'Billing provider is temporarily unavailable');
    }
    if (err instanceof Stripe.errors.StripeInvalidRequestError) {
      return new StripeBillingError('BILLING_CONFIGURATION_ERROR', 'Billing configuration error');
    }
    if (err instanceof Stripe.errors.StripeAPIError) {
      return new StripeBillingError('BILLING_PROVIDER_UNAVAILABLE', 'Billing provider is temporarily unavailable');
    }
    return new StripeBillingError('BILLING_PROVIDER_UNAVAILABLE', 'Billing provider error');
  }
}
