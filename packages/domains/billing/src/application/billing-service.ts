import { BillingProvider } from '../domain/provider';
import { BillingCustomerRepository, BillingPlanMappingRepository } from '../domain/mappings';
import { BillingWebhookEventRepository, BillingEventRepository } from '../domain/webhook-events';
import { SubscriptionsService, Subscription } from '@vibress/subscriptions';
import { Plan } from '@vibress/plans';
import { Product } from '@vibress/products';
import { Member } from '@vibress/members';
import { Offer, OffersService } from '@vibress/offers';
import { domainEvents } from '@vibress/events';
import { runInTransaction } from '@vibress/database';
import crypto from 'node:crypto';

export class BillingDomainError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export interface CheckoutContext {
  member: Member;
  plan: Plan;
  product: Product;
  offer: Offer | null;
  successPath: string;
  cancelPath: string;
}

export interface BillingServiceDeps {
  provider: BillingProvider;
  customerRepo: BillingCustomerRepository;
  mappingRepo: BillingPlanMappingRepository;
  webhookEventRepo: BillingWebhookEventRepository;
  billingEventRepo: BillingEventRepository;
  subscriptionsService: SubscriptionsService;
  offersService: OffersService;
  planRepository: { findById(id: string): Promise<Plan | null> };
  productRepository: { findById(id: string): Promise<Product | null> };
  memberRepository: { findById(id: string): Promise<Member | null> };
  memberEmailProvider: (member: Member) => string;
  portalUrl: string;
  successPath: string;
  cancelPath: string;
}

function safeReturnPath(path: string): string {
  // Only allow internal relative paths; reject open redirects
  if (!path.startsWith('/') || path.startsWith('//')) {
    return '/account';
  }
  if (path.startsWith('http:') || path.startsWith('https:') || path.startsWith('javascript:')) {
    return '/account';
  }
  return path;
}

const MAP_STATUS: Record<string, Subscription['status']> = {
  trialing: 'trialing',
  active: 'active',
  past_due: 'past_due',
  unpaid: 'unpaid',
  canceled: 'cancelled',
  cancelled: 'cancelled',
  incomplete: 'incomplete',
  incomplete_expired: 'expired',
  expired: 'expired',
};

export class BillingService {
  constructor(private deps: BillingServiceDeps) {}

  /**
   * Creates a provider-hosted checkout session for a member + plan.
   * Server resolves price; browser-supplied amounts are never trusted.
   */
  async createCheckoutSession(
    memberId: string,
    planId: string,
    offerKey: string | null | undefined
  ): Promise<{ checkoutUrl: string; checkoutSessionId: string }> {
    const member = await this.deps.memberRepository.findById(memberId);
    if (!member) throw new BillingDomainError('BILLING_AUTH_REQUIRED', 'Member not found');
    if (member.status === 'disabled') throw new BillingDomainError('BILLING_AUTH_REQUIRED', 'Member is disabled');

    const plan = await this.deps.planRepository.findById(planId);
    if (!plan) throw new BillingDomainError('PLAN_NOT_FOUND', 'Plan not found');
    if (plan.status !== 'active') throw new BillingDomainError('PLAN_NOT_AVAILABLE', 'Plan is not available');
    const product = await this.deps.productRepository.findById(plan.productId);
    if (!product || product.status !== 'active') throw new BillingDomainError('PRODUCT_NOT_FOUND', 'Product not found');

    // Duplicate prevention: one active subscription per product per member
    const existing = await this.deps.subscriptionsService.listSubscriptions({ memberId, productId: product.id, limit: 5 });
    const active = existing.subscriptions.find((s) => ['trialing', 'active', 'past_due', 'unpaid'].includes(s.status));
    if (active) {
      throw new BillingDomainError('SUBSCRIPTION_ALREADY_ACTIVE', 'Member already has an active subscription for this product');
    }

    // Resolve offer
    let offer: Offer | null = null;
    if (offerKey) {
      const found = await this.deps.offersService.getOfferByKey(offerKey);
      if (!found) throw new BillingDomainError('OFFER_NOT_FOUND', 'Offer not found');
      try {
        await this.deps.offersService.validateOffer(found, plan.id, new Date());
        if (found.discountType === 'fixed_amount' && found.discountValue > plan.amountMinor) {
          throw new BillingDomainError('OFFER_INVALID', 'Offer discount exceeds plan price');
        }
      } catch (err: unknown) {
        if (err instanceof BillingDomainError) throw err;
        if (err instanceof Error && 'code' in err && typeof (err as { code?: unknown }).code === 'string') {
          throw new BillingDomainError((err as { code: string }).code, err.message);
        }
        throw err;
      }
      offer = found;
    }

    // Free plan flow: no external provider records
    if (plan.billingType === 'free') {
      const subscription = await runInTransaction(() =>
        this.createFreeSubscriptionTx({
          memberId: member.id,
          productId: product.id,
          planId: plan.id,
          offer: offer as Offer | null,
        })
      );
      return { checkoutUrl: `${this.deps.portalUrl}/account`, checkoutSessionId: `free-${subscription.id}` };
    }

    // Paid flow: ensure customer mapping
    let billingCustomer = await this.deps.customerRepo.findByMemberId(member.id, this.deps.provider.name);
    if (!billingCustomer) {
      const providerCustomerId = await this.deps.provider.createCustomer({
        email: this.deps.memberEmailProvider(member),
        name: member.name || undefined,
      });
      billingCustomer = await this.deps.customerRepo.findOrCreate({
        memberId: member.id,
        provider: this.deps.provider.name,
        providerCustomerId,
      });
    }

    // Ensure plan mapping exists
    const mapping = await this.deps.mappingRepo.findByPlanId(plan.id, this.deps.provider.name);
    if (!mapping) {
      throw new BillingDomainError('BILLING_CONFIGURATION_ERROR', 'Plan is not configured with a billing price');
    }

    const successUrl = `${this.deps.portalUrl}${safeReturnPath(this.deps.successPath)}`;
    const cancelUrl = `${this.deps.portalUrl}${safeReturnPath(this.deps.cancelPath)}`;

    const result = await this.deps.provider.createCheckoutSession({
      customerId: billingCustomer.providerCustomerId,
      priceId: mapping.providerPriceId,
      successUrl,
      cancelUrl,
      metadata: { memberId: member.id, planId: plan.id, productId: product.id },
      subscriptionData: {
        trialDays: plan.trialDays > 0 ? plan.trialDays : undefined,
        metadata: {
          memberId: member.id,
          planId: plan.id,
          ...(offer ? { offerId: offer.id } : {}),
        },
      },
    });

    domainEvents.emit('checkout.started', { memberId: member.id, planId: plan.id });
    await this.deps.billingEventRepo.record({
      memberId: member.id,
      provider: this.deps.provider.name,
      type: 'checkout.started',
      data: { planId: plan.id, productId: product.id, checkoutSessionId: result.checkoutSessionId },
    });

    return { checkoutUrl: result.url, checkoutSessionId: result.checkoutSessionId };
  }

  private async createFreeSubscriptionTx(params: {
    memberId: string;
    productId: string;
    planId: string;
    offer: Offer | null;
  }): Promise<{ id: string }> {
    const subscription = await this.deps.subscriptionsService.createSubscription({
      memberId: params.memberId,
      productId: params.productId,
      planId: params.planId,
      provider: null,
      status: 'active',
      currency: 'USD',
      amountMinor: 0,
      billingInterval: 'month',
      intervalCount: 1,
      offerId: params.offer ? params.offer.id : null,
    });
    if (params.offer) {
      await this.deps.offersService.redeemOffer(params.offer.id, new Date());
      domainEvents.emit('offer.redeemed', { offerId: params.offer.id, memberId: params.memberId });
    }
    await this.deps.billingEventRepo.record({
      subscriptionId: subscription.id,
      memberId: params.memberId,
      type: 'subscription.created',
      data: { planId: params.planId, productId: params.productId, free: true },
    });
    return { id: subscription.id };
  }

  async createBillingPortalSession(memberId: string): Promise<{ url: string }> {
    const member = await this.deps.memberRepository.findById(memberId);
    if (!member) throw new BillingDomainError('BILLING_AUTH_REQUIRED', 'Member not found');

    const billingCustomer = await this.deps.customerRepo.findByMemberId(member.id, this.deps.provider.name);
    if (!billingCustomer) {
      throw new BillingDomainError('BILLING_CONFIGURATION_ERROR', 'No billing customer for this member');
    }

    const result = await this.deps.provider.createBillingPortalSession({
      customerId: billingCustomer.providerCustomerId,
      returnUrl: `${this.deps.portalUrl}/account`,
    });

    domainEvents.emit('billing_portal.opened', { memberId: member.id });
    return { url: result.url };
  }

  /**
   * Verifies webhook signature, persists event (dedup), and processes.
   * Returns true if the event was new and processed, false if duplicate.
   */
  async handleWebhook(
    providerName: string,
    rawPayload: string | Buffer,
    signatureHeader: string | null | undefined
  ): Promise<{ processed: boolean; status: number }> {
    if (this.deps.provider.name !== providerName) {
      return { processed: false, status: 404 };
    }

    const verified = await this.deps.provider.verifyWebhookSignature(rawPayload, signatureHeader);
    if (!verified) {
      return { processed: false, status: 400 };
    }

    const event = await this.deps.provider.parseWebhookEvent(rawPayload);
    const payloadHash = crypto.createHash('sha256').update(rawPayload.toString()).digest('hex');

    // Dedup: unique(provider, provider_event_id)
    const existing = await this.deps.webhookEventRepo.findByProviderEventId(providerName, event.id);
    if (existing) {
      if (existing.status !== 'processed') {
        // Retry previously failed event
        await this.processEvent(existing.id, event);
      }
      return { processed: false, status: 200 };
    }

    const record = await this.deps.webhookEventRepo.create({
      provider: providerName,
      providerEventId: event.id,
      eventType: event.type,
      payloadHash,
    });

    try {
      await this.processEvent(record.id, event);
      await this.deps.webhookEventRepo.markProcessed(record.id);
    } catch (err: unknown) {
      await this.deps.webhookEventRepo.markFailed(record.id, err instanceof Error ? err.message : 'processing failed', 1);
      throw err;
    }

    return { processed: true, status: 200 };
  }

  /**
   * Processes a verified provider event into Vibress subscription state.
   */
  private async processEvent(
    eventRecordId: string,
    event: { id: string; type: string; created: number; data: Record<string, unknown> }
  ): Promise<void> {
    return runInTransaction(() => this.processEventTx(eventRecordId, event));
  }

  private async processEventTx(
    eventRecordId: string,
    event: { id: string; type: string; created: number; data: Record<string, unknown> }
  ): Promise<void> {
    // Provider event objects are heterogeneous; treated as opaque records
    const object = event.data as Record<string, unknown>;
    // Invoice-type events carry the subscription id in object.subscription
    const providerSubscriptionId =
      typeof object.subscription === 'string'
        ? object.subscription
        : typeof object.id === 'string'
          ? object.id
          : null;
    const eventTimestamp = new Date(event.created * 1000);

    if (!providerSubscriptionId) {
      await this.deps.billingEventRepo.record({
        provider: this.deps.provider.name,
        providerEventId: event.id,
        type: 'webhook.ignored',
        data: { eventType: event.type },
      });
      return;
    }

    // Find or create the Vibress subscription
    let subscription = await this.deps.subscriptionsService.getSubscriptionByProviderId(
      this.deps.provider.name,
      providerSubscriptionId
    );

    if (!subscription) {
      // Subscription unknown: derive from provider metadata when available
      const metadata = (object.metadata || {}) as Record<string, string>;
      const memberId = metadata.memberId;
      const planId = metadata.planId;
      if (!memberId || !planId) {
        await this.deps.billingEventRepo.record({
          provider: this.deps.provider.name,
          providerEventId: event.id,
          type: 'webhook.ignored',
          data: { reason: 'no member/plan metadata', eventType: event.type },
        });
        return;
      }
      const plan = await this.deps.planRepository.findById(planId);
      if (!plan) throw new BillingDomainError('PLAN_NOT_FOUND', 'Plan not found for webhook');

      const providerCustomerId = typeof object.customer === 'string' ? object.customer : null;
      subscription = await this.deps.subscriptionsService.createSubscription({
        memberId,
        productId: plan.productId,
        planId: plan.id,
        provider: this.deps.provider.name,
        providerSubscriptionId,
        providerCustomerId,
        status: this.mapProviderStatus(event.type === 'customer.subscription.trialing' ? 'trialing' : (object.status as string) || 'active'),
        currency: typeof object.currency === 'string' ? object.currency.toUpperCase() : plan.currency,
        amountMinor: typeof object.amount === 'number' ? object.amount : plan.amountMinor,
        billingInterval: plan.billingInterval || 'month',
        intervalCount: plan.intervalCount,
        currentPeriodStart: typeof object.current_period_start === 'number' ? new Date(object.current_period_start * 1000) : null,
        currentPeriodEnd: typeof object.current_period_end === 'number' ? new Date(object.current_period_end * 1000) : null,
        trialStart: typeof object.trial_start === 'number' ? new Date(object.trial_start * 1000) : null,
        trialEnd: typeof object.trial_end === 'number' ? new Date(object.trial_end * 1000) : null,
        cancelAtPeriodEnd: !!object.cancel_at_period_end,
        offerId: typeof metadata.offerId === 'string' ? metadata.offerId : null,
        providerEventTimestamp: eventTimestamp,
      });
    } else {
      // Out-of-order protection handled inside applyProviderUpdate
      subscription = await this.deps.subscriptionsService.applyProviderUpdate(
        subscription.id,
        {
          status: this.mapProviderStatus((object.status as string) || subscription.status),
          currentPeriodStart: typeof object.current_period_start === 'number' ? new Date(object.current_period_start * 1000) : undefined,
          currentPeriodEnd: typeof object.current_period_end === 'number' ? new Date(object.current_period_end * 1000) : undefined,
          trialStart: typeof object.trial_start === 'number' ? new Date(object.trial_start * 1000) : undefined,
          trialEnd: typeof object.trial_end === 'number' ? new Date(object.trial_end * 1000) : undefined,
          cancelAtPeriodEnd: typeof object.cancel_at_period_end === 'boolean' ? object.cancel_at_period_end : undefined,
          providerEventTimestamp: eventTimestamp,
        },
        eventTimestamp
      );
    }

    // Record billing event history
    await this.deps.billingEventRepo.record({
      subscriptionId: subscription.id,
      memberId: subscription.memberId,
      provider: this.deps.provider.name,
      providerEventId: event.id,
      type: this.mapEventType(event.type),
      data: { eventType: event.type, status: subscription.status },
    });
  }

  private mapProviderStatus(providerStatus: string): Subscription['status'] {
    const normalized = providerStatus.toLowerCase();
    return MAP_STATUS[normalized] || 'incomplete';
  }

  private mapEventType(providerType: string): string {
    switch (providerType) {
      case 'checkout.session.completed':
        return 'checkout.completed';
      case 'customer.subscription.created':
        return 'subscription.created';
      case 'customer.subscription.updated':
        return 'subscription.updated';
      case 'customer.subscription.deleted':
        return 'subscription.cancelled';
      case 'invoice.payment_succeeded':
        return 'subscription.payment_succeeded';
      case 'invoice.payment_failed':
        return 'subscription.payment_failed';
      default:
        return 'subscription.updated';
    }
  }
}
