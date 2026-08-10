import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../main';
import { setBillingServiceForTests } from '../services';
import { FastifyInstance } from 'fastify';
import {
  DrizzleMemberRepository,
  DrizzleMemberAuthTokenRepository,
  DrizzleMemberSessionRepository,
  MemberAuthService,
} from '@vibress/members';
import {
  DrizzleProductRepository,
  ProductsService,
} from '@vibress/products';
import {
  DrizzlePlanRepository,
  PlansService,
} from '@vibress/plans';
import {
  DrizzleOfferRepository,
  OffersService,
} from '@vibress/offers';
import {
  DrizzleSubscriptionRepository,
  SubscriptionsService,
} from '@vibress/subscriptions';
import {
  DrizzleBillingCustomerRepository,
  DrizzleBillingPlanMappingRepository,
  DrizzleBillingWebhookEventRepository,
  DrizzleBillingEventRepository,
  BillingService,
  BillingProvider,
  BillingCheckoutInput,
  BillingPortalInput,
  BillingCreateCustomerInput,
  BillingSubscriptionInfo,
  BillingCheckoutResult,
  BillingPortalResult,
} from '@vibress/billing';
import Stripe from 'stripe';
import { getDb, users, userRoles, roles } from '@vibress/database';
import { eq } from 'drizzle-orm';
import { hashPassword } from '@vibress/security';

async function ensureOwner(): Promise<void> {
  // Integration tests elsewhere TRUNCATE users; ensure the owner exists so
  // staff-login scenarios are deterministic regardless of test order.
  const db = getDb();
  const rows = await db.select().from(users).where(eq(users.email, 'owner@example.com')).limit(1);
  if (rows.length > 0) return;
  const hash = await hashPassword('OwnerPass123!');
  const ownerId = `owner-${Date.now()}`;
  await db.insert(users).values({
    id: ownerId,
    email: 'owner@example.com',
    name: 'Owner',
    slug: 'e2e-owner',
    passwordHash: hash,
    status: 'active',
  });
  // Grant the owner role if present
  const ownerRole = await db.select({ id: roles.id }).from(roles).where(eq(roles.key, 'owner')).limit(1);
  if (ownerRole[0]) {
    await db.insert(userRoles).values({ userId: ownerId, roleId: ownerRole[0].id });
  }
}

class CaptureMailer {
  sent: Array<{ to: string; magicLinkUrl: string }> = [];
  async sendMagicLink(input: any): Promise<void> {
    this.sent.push({ to: input.to, magicLinkUrl: input.magicLinkUrl });
  }
}

class FakeBillingProvider implements BillingProvider {
  name = 'stripe';
  customers: string[] = [];
  checkoutSessions: BillingCheckoutInput[] = [];

  async createCustomer(input: BillingCreateCustomerInput): Promise<string> {
    const id = `cus_fake_${this.customers.length + 1}`;
    this.customers.push(id);
    return id;
  }
  async createCheckoutSession(input: BillingCheckoutInput): Promise<BillingCheckoutResult> {
    this.checkoutSessions.push(input);
    return { url: 'https://checkout.example.test/session/1', checkoutSessionId: 'cs_fake_1' };
  }
  async createBillingPortalSession(_input: BillingPortalInput): Promise<BillingPortalResult> {
    return { url: 'https://billing.example.test/portal/1' };
  }
  async getSubscription(_id: string): Promise<BillingSubscriptionInfo | null> {
    return null;
  }
  async cancelSubscription(_id: string): Promise<void> {}
  async verifyWebhookSignature(_payload: string | Buffer, signatureHeader: string | null | undefined): Promise<boolean> {
    if (signatureHeader === 'stripe-signature-valid') return true;
    if (!signatureHeader) return false;
    try {
      Stripe.webhooks.constructEvent(_payload, signatureHeader, WEBHOOK_SECRET);
      return true;
    } catch {
      return false;
    }
  }
  async parseWebhookEvent(payload: string | Buffer): Promise<{ id: string; type: string; created: number; data: Record<string, unknown> }> {
    const event = JSON.parse(payload.toString());
    return {
      id: event.id,
      type: event.type,
      created: event.created,
      data: event.data.object as Record<string, unknown>,
    };
  }
}

async function signupMember(app: FastifyInstance, email: string): Promise<{ memberId: string; cookie: string }> {
  const mailer = new CaptureMailer();
  const memberRepo = new DrizzleMemberRepository();
  const authService = new MemberAuthService(
    memberRepo,
    new DrizzleMemberAuthTokenRepository(),
    new DrizzleMemberSessionRepository(),
    mailer,
    () => true
  );
  await authService.requestAuthLink(email);
  const link = mailer.sent[0]?.magicLinkUrl;
  if (!link) throw new Error('no magic link captured');
  const token = new URL(link).searchParams.get('token') || '';
  const res = await app.inject({ method: 'POST', url: '/api/members/v1/auth/verify', payload: { token } });
  expect(res.statusCode).toBe(200);
  const body = res.json();
  const setCookie = (res.headers['set-cookie'] as unknown as string) || '';
  const cookie: string = setCookie.split(';')[0] ?? '';
  const memberId: string = body.member?.id ?? '';
  return { memberId, cookie };
}

async function loginStaff(app: FastifyInstance, email: string, password: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/admin/v1/auth/login',
    payload: { email, password },
  });
  expect(res.statusCode).toBe(200);
  const setCookie = (res.headers['set-cookie'] as unknown as string) || '';
  return setCookie.split(';')[0] ?? '';
}

const WEBHOOK_SECRET = 'whsec_int_test';

describe('Batch 9 — Billing Integration & Security', () => {
  let app: FastifyInstance;
  let provider: FakeBillingProvider;
  let memberCookie: string;
  let memberB: string;
  let memberAEmailSuffix: string;
  let otherMemberCookie: string;
  let staffCookie: string;
  let productId: string;
  let planId: string;
  let freePlanId: string;
  let freeProductId: string;
  let runSuffix: string;
  let offerId: string;
  let offerKey: string;

  beforeAll(async () => {
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
    process.env.STRIPE_SECRET_KEY = 'sk_test_int';
    process.env.PORTAL_ORIGIN = 'https://portal.example.test';
    app = buildApp();
    await app.ready();

    const memberRepo = new DrizzleMemberRepository();
    const planRepo = new DrizzlePlanRepository();
    const productRepo = new DrizzleProductRepository();
    const offerRepo = new DrizzleOfferRepository();
    const subRepo = new DrizzleSubscriptionRepository();
    const billingCustomerRepo = new DrizzleBillingCustomerRepository();
    const mappingRepo = new DrizzleBillingPlanMappingRepository();
    const webhookEventRepo = new DrizzleBillingWebhookEventRepository();
    const billingEventRepo = new DrizzleBillingEventRepository();

    const productsService = new ProductsService(productRepo);
    const plansService = new PlansService(planRepo, async (id) => !!(await productRepo.findById(id)));
    const offersService = new OffersService(
      offerRepo,
      async (id) => !!(await productRepo.findById(id)),
      async (id) => !!(await planRepo.findById(id))
    );
    const subscriptionsService = new SubscriptionsService(subRepo);
    provider = new FakeBillingProvider();
    const testBillingService = new BillingService({
      provider,
      customerRepo: billingCustomerRepo,
      mappingRepo,
      webhookEventRepo,
      billingEventRepo,
      subscriptionsService,
      offersService,
      planRepository: planRepo,
      productRepository: productRepo,
      memberRepository: memberRepo,
      memberEmailProvider: (m) => m.email,
      portalUrl: 'https://portal.example.test',
      successPath: '/account',
      cancelPath: '/plans',
    });
    setBillingServiceForTests(testBillingService);

    // Seed product + plans + offer
    runSuffix = `${Date.now()}${Math.random().toString(36).slice(2, 7)}`;
    const product = await productsService.createProduct({ key: `premium${runSuffix}`, name: 'Premium' }, null);
    productId = product.id;
    const plan = await plansService.createPlan({
      productId: product.id,
      key: 'monthly',
      name: 'Monthly',
      billingInterval: 'month',
      currency: 'USD',
      amountMinor: 1000,
    }, null);
    planId = plan.id;
    const freeProduct = await productsService.createProduct({ key: `free${runSuffix}`, name: 'Free Membership' }, null);
    freeProductId = freeProduct.id;
    const freePlan = await plansService.createPlan({ productId: freeProduct.id, key: 'free', name: 'Free', billingType: 'free' }, null);
    freePlanId = freePlan.id;
    const offer = await offersService.createOffer({
      productId: product.id,
      key: `save20${runSuffix}`,
      name: 'Save 20',
      discountType: 'percentage',
      discountValue: 20,
      maxRedemptions: 2,
    }, null);
    offerId = offer.id;
    offerKey = offer.key;
    await mappingRepo.upsert({ planId: plan.id, provider: 'stripe', providerProductId: 'prod_1', providerPriceId: 'price_1' });

    // Members + staff
    memberAEmailSuffix = `${Date.now()}_${Math.random().toString(36).slice(2, 7).replace('_','x')}`;
    const member = await signupMember(app, `member-a-${memberAEmailSuffix}@example.com`);
    memberCookie = member.cookie;
    const other = await signupMember(app, `member-b-${Date.now()}@example.com`);
    otherMemberCookie = other.cookie;
    memberB = other.memberId;
    await ensureOwner();
    staffCookie = await loginStaff(app, 'owner@example.com', 'OwnerPass123!');
  });

  afterAll(async () => {
    await app.close();
  });

  // ---------- Public catalog ----------
  it('public catalog exposes only active public products with plans', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/content/v1/products' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const product = body.products.find((p: any) => p.id === productId);
    expect(product).toBeTruthy();
    expect(product.plans.some((pl: any) => pl.id === planId)).toBe(true);
    const freeProduct = body.products.find((p: any) => p.id === freeProductId);
    expect(freeProduct).toBeTruthy();
    expect(freeProduct.plans.some((pl: any) => pl.id === freePlanId)).toBe(true);
  });

  it('public catalog hides provider internals', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/content/v1/products' });
    const text = res.body;
    expect(text).not.toContain('price_1');
    expect(text).not.toContain('providerSubscription');
    expect(text).not.toContain('stripe');
  });

  // ---------- Checkout ----------
  it('checkout requires member auth', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/members/v1/billing/checkout',
      payload: { planId },
    });
    expect(res.statusCode).toBe(401);
  });

  it('checkout rejects an unknown plan', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/members/v1/billing/checkout',
      payload: { planId: 'plan_does_not_exist' },
      headers: { cookie: memberCookie, origin: 'https://portal.example.test' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().errors[0].code).toBe('PLAN_NOT_FOUND');
  });

  it('checkout rejects archived plans', async () => {
    const planRepo = new DrizzlePlanRepository();
    const archived = await planRepo.create({
      productId,
      key: 'legacy',
      name: 'Legacy',
      billingInterval: 'month',
      currency: 'USD',
      amountMinor: 500,
      status: 'archived',
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/members/v1/billing/checkout',
      payload: { planId: archived.id },
      headers: { cookie: memberCookie, origin: 'https://portal.example.test' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().errors[0].code).toBe('PLAN_NOT_AVAILABLE');
  });

  it('client-supplied amount cannot override server price', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/members/v1/billing/checkout',
      payload: { planId, amountMinor: 1, currency: 'USD' },
      headers: { cookie: memberCookie, origin: 'https://portal.example.test' },
    });
    expect(res.statusCode).toBe(200);
    const session = provider.checkoutSessions[provider.checkoutSessions.length - 1]!;
    // Server price resolution: price_1 (mapped), not client-supplied amount
    expect(session.priceId).toBe('price_1');
  });

  it('checkout succeeds with an active offer', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/members/v1/billing/checkout',
      payload: { planId, offerKey },
      headers: { cookie: memberCookie, origin: 'https://portal.example.test' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().checkoutUrl).toBeTruthy();
  });

  it('checkout rejects an unknown offer', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/members/v1/billing/checkout',
      payload: { planId, offerKey: 'NOPE' },
      headers: { cookie: memberCookie, origin: 'https://portal.example.test' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().errors[0].code).toBe('OFFER_NOT_FOUND');
  });

  it('checkout rejects an offer with depleted redemptions', async () => {
    const offerRepo = new DrizzleOfferRepository();
    // deplete offer
    await offerRepo.incrementRedemption(offerId, new Date());
    await offerRepo.incrementRedemption(offerId, new Date());
    const res = await app.inject({
      method: 'POST',
      url: '/api/members/v1/billing/checkout',
      payload: { planId, offerKey },
      headers: { cookie: otherMemberCookie, origin: 'https://portal.example.test' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().errors[0].code).toBe('OFFER_REDEMPTION_LIMIT_REACHED');
  });

  it('duplicate checkout is controlled: second checkout for same member+product rejected', async () => {
    // Member A: create an active subscription on the premium product
    const memberRepo = new DrizzleMemberRepository();
    const subRepo = new DrizzleSubscriptionRepository();
    const memberA = await memberRepo.findByEmailNormalized(`member-a-${memberAEmailSuffix}@example.com`);
    if (!memberA) throw new Error('member A not found');
    const activeSub = await subRepo.findActiveForMember(memberA.id, productId);
    if (!activeSub) {
      await subRepo.create({
        memberId: memberA.id,
        productId,
        planId,
        status: 'active',
        currency: 'USD',
        amountMinor: 1000,
        billingInterval: 'month',
      });
    }
    const res = await app.inject({
      method: 'POST',
      url: '/api/members/v1/billing/checkout',
      payload: { planId },
      headers: { cookie: memberCookie, origin: 'https://portal.example.test' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().errors[0].code).toBe('SUBSCRIPTION_ALREADY_ACTIVE');
  });

  it('checkout validates Host-header independent return URLs (no open redirect)', async () => {
    const fresh = await signupMember(app, `host-${Date.now()}@example.com`);
    const res = await app.inject({
      method: 'POST',
      url: '/api/members/v1/billing/checkout',
      headers: { cookie: fresh.cookie, origin: 'https://portal.example.test', host: 'evil.example.com' },
      payload: { planId },
    });
    expect(res.statusCode).toBe(200);
    const session = provider.checkoutSessions[provider.checkoutSessions.length - 1]!;
    expect(session.successUrl.startsWith('https://portal.example.test')).toBe(true);
    expect(session.successUrl).not.toContain('evil.example.com');
  });

  it('free plan activates a subscription without provider records', async () => {
    const subRepo = new DrizzleSubscriptionRepository();
    const before = provider.customers.length;
    const res = await app.inject({
      method: 'POST',
      url: '/api/members/v1/billing/checkout',
      payload: { planId: freePlanId },
      headers: { cookie: otherMemberCookie, origin: 'https://portal.example.test' },
    });
    expect(res.statusCode).toBe(200);
    expect(provider.customers.length).toBe(before); // no provider customer created
    const subs = await subRepo.list({ memberId: memberB });
    const free = subs.subscriptions.find((s) => s.planId === freePlanId);
    expect(free).toBeTruthy();
    expect(free!.status).toBe('active');
    expect(free!.provider).toBeNull(); // no fake provider record
  });

  it('free plan checkout returns internal portal URL, not provider URL', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/members/v1/billing/checkout',
      payload: { planId: freePlanId },
      headers: { cookie: memberCookie, origin: 'https://portal.example.test' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().checkoutUrl.startsWith('https://portal.example.test/account')).toBe(true);
  });

  // ---------- Member subscription API ----------
  it('member lists own subscriptions', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/members/v1/subscriptions', headers: { cookie: otherMemberCookie } });
    expect(res.statusCode).toBe(200);
    const subs = res.json().subscriptions;
    expect(subs.length).toBeGreaterThanOrEqual(1);
    for (const s of subs) {
      expect(s).not.toHaveProperty('providerSubscriptionId');
      expect(s).not.toHaveProperty('providerCustomerId');
      expect(s).not.toHaveProperty('provider');
    }
  });

  it('IDOR: member A cannot view member B subscription', async () => {
    const subRepo = new DrizzleSubscriptionRepository();
    const subs = await subRepo.list({ memberId: memberB });
    const otherSub = subs.subscriptions[0]!;
    const res = await app.inject({ method: 'GET', url: `/api/members/v1/subscriptions/${otherSub.id}`, headers: { cookie: memberCookie } });
    expect(res.statusCode).toBe(404);
  });

  it('IDOR: member A cannot cancel member B subscription', async () => {
    const subRepo = new DrizzleSubscriptionRepository();
    const subs = await subRepo.list({ memberId: memberB });
    const otherSub = subs.subscriptions[0]!;
    const res = await app.inject({
      method: 'POST',
      url: `/api/members/v1/subscriptions/${otherSub.id}/cancel`,
      headers: { cookie: memberCookie, origin: 'https://portal.example.test' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('IDOR: member A cannot resume member B subscription', async () => {
    const subRepo = new DrizzleSubscriptionRepository();
    const subs = await subRepo.list({ memberId: memberB });
    const otherSub = subs.subscriptions[0]!;
    const res = await app.inject({
      method: 'POST',
      url: `/api/members/v1/subscriptions/${otherSub.id}/resume`,
      headers: { cookie: memberCookie, origin: 'https://portal.example.test' },
    });
    expect(res.statusCode).toBe(404);
  });

  // ---------- Webhooks ----------
  function signedPayload(type: string, object: Record<string, unknown>): { payload: string; header: string } {
    const payload = JSON.stringify({
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      object: 'event',
      api_version: '2024-06-20',
      created: Math.floor(Date.now() / 1000),
      type,
      data: { object },
    });
    const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
    return { payload, header };
  }

  it('webhook rejects invalid signature', async () => {
    const { payload } = signedPayload('customer.subscription.updated', { id: 'sub_x' });
    const res = await app.inject({
      method: 'POST',
      url: '/api/webhooks/v1/billing/stripe',
      headers: { 'content-type': 'application/json', 'stripe-signature': 'bogus' },
      payload,
    });
    expect(res.statusCode).toBe(400);
  });

  it('webhook accepts valid signed event and creates subscription', async () => {
    const { payload, header } = signedPayload('customer.subscription.created', {
      id: `sub_run_${runSuffix}`,
      object: 'subscription',
      customer: 'cus_new_1',
      status: 'active',
      currency: 'usd',
      current_period_start: Math.floor(Date.now() / 1000),
      current_period_end: Math.floor(Date.now() / 1000) + 2592000,
      cancel_at_period_end: false,
      metadata: { memberId: memberB, planId: planId },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/webhooks/v1/billing/stripe',
      headers: { 'content-type': 'application/json', 'stripe-signature': header },
      payload,
    });
    expect(res.statusCode).toBe(200);
    const subRepo = new DrizzleSubscriptionRepository();
    const found = await subRepo.findByProviderSubscriptionId('stripe', `sub_run_${runSuffix}`);
    expect(found).toBeTruthy();
    expect(found!.status).toBe('active');
    expect(found!.memberId).toBe(memberB);
    expect(found!.amountMinor).toBe(1000); // server-resolved price snapshot
  });

  it('webhook duplicate event does not duplicate subscription changes', async () => {
    const { payload, header } = signedPayload('customer.subscription.updated', {
      id: `sub_run_${runSuffix}`,
      object: 'subscription',
      status: 'active',
      cancel_at_period_end: false,
    });
    // First delivery
    const res1 = await app.inject({
      method: 'POST',
      url: '/api/webhooks/v1/billing/stripe',
      headers: { 'content-type': 'application/json', 'stripe-signature': header },
      payload,
    });
    expect(res1.statusCode).toBe(200);
    // Replay same event ID
    const res2 = await app.inject({
      method: 'POST',
      url: '/api/webhooks/v1/billing/stripe',
      headers: { 'content-type': 'application/json', 'stripe-signature': header },
      payload,
    });
    expect(res2.statusCode).toBe(200);
    const subRepo = new DrizzleSubscriptionRepository();
    const found = await subRepo.findByProviderSubscriptionId('stripe', `sub_run_${runSuffix}`);
    expect(found).toBeTruthy();
  });

  it('webhook payment failure transitions subscription to past_due', async () => {
    const { payload, header } = signedPayload('invoice.payment_failed', {
      id: `sub_run_${runSuffix}`,
      object: 'invoice',
      subscription: `sub_run_${runSuffix}`,
      status: 'past_due',
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/webhooks/v1/billing/stripe',
      headers: { 'content-type': 'application/json', 'stripe-signature': header },
      payload,
    });
    expect(res.statusCode).toBe(200);
    const subRepo = new DrizzleSubscriptionRepository();
    const found = await subRepo.findByProviderSubscriptionId('stripe', `sub_run_${runSuffix}`);
    expect(found!.status).toBe('past_due');
    // Member account NOT disabled by payment failure
    const memberRepo = new DrizzleMemberRepository();
    const member = await memberRepo.findById(memberB);
    expect(member!.status).toBe('active');
  });

  it('webhook out-of-order: older event does not overwrite newer state', async () => {
    const subRepo = new DrizzleSubscriptionRepository();
    const found = await subRepo.findByProviderSubscriptionId('stripe', `sub_run_${runSuffix}`);
    // Apply a newer event (cancelled at period end, current time)
    const newerTimestamp = Math.floor(Date.now() / 1000);
    const { payload: p1, header: h1 } = signedPayload('customer.subscription.updated', {
      id: `sub_run_${runSuffix}`,
      status: 'active',
      cancel_at_period_end: true,
      current_period_start: newerTimestamp,
    });
    const res1 = await app.inject({
      method: 'POST',
      url: '/api/webhooks/v1/billing/stripe',
      headers: { 'content-type': 'application/json', 'stripe-signature': h1 },
      payload: p1,
    });
    expect(res1.statusCode).toBe(200);

    // Older event with old timestamp arrives late — signature over identical payload
    const oldPayload = JSON.stringify({
      id: `evt_old_${Date.now()}`,
      object: 'event',
      api_version: '2024-06-20',
      created: newerTimestamp - 3600, // 1 hour older
      type: 'customer.subscription.updated',
      data: { object: { id: `sub_run_${runSuffix}`, status: 'active', cancel_at_period_end: false } },
    });
    const oldHeader = Stripe.webhooks.generateTestHeaderString({ payload: oldPayload, secret: WEBHOOK_SECRET });
    const res = await app.inject({
      method: 'POST',
      url: '/api/webhooks/v1/billing/stripe',
      headers: { 'content-type': 'application/json', 'stripe-signature': oldHeader },
      payload: oldPayload,
    });
    expect(res.statusCode).toBe(200);
    // State should NOT be overwritten by the old event
    const after = await subRepo.findByProviderSubscriptionId('stripe', `sub_run_${runSuffix}`);
    expect(after!.providerEventTimestamp!.getTime()).toBeGreaterThanOrEqual(newerTimestamp * 1000);
  });

  it('cancellation webhook transitions subscription to cancelled', async () => {
    const { payload, header } = signedPayload('customer.subscription.deleted', {
      id: `sub_run_${runSuffix}`,
      object: 'subscription',
      status: 'canceled',
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/webhooks/v1/billing/stripe',
      headers: { 'content-type': 'application/json', 'stripe-signature': header },
      payload,
    });
    expect(res.statusCode).toBe(200);
    const subRepo = new DrizzleSubscriptionRepository();
    const found = await subRepo.findByProviderSubscriptionId('stripe', `sub_run_${runSuffix}`);
    expect(found!.status).toBe('cancelled');
  });

  // ---------- Cancel / resume ----------
  it('member cancels own subscription at period end', async () => {
    const subRepo = new DrizzleSubscriptionRepository();
    const subs = await subRepo.list({ memberId: memberB });
    const active = subs.subscriptions.find((s) => s.status === 'active' && s.planId === planId);
    if (!active) {
      // Create one via checkout-free path
      const created = await subRepo.create({
        memberId: memberB,
        productId,
        planId,
        status: 'active',
        currency: 'USD',
        amountMinor: 1000,
        billingInterval: 'month',
      });
      const res = await app.inject({
        method: 'POST',
        url: `/api/members/v1/subscriptions/${created.id}/cancel`,
        headers: { cookie: otherMemberCookie, origin: 'https://portal.example.test' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().subscription.cancelAtPeriodEnd).toBe(true);
      // Member NOT disabled, NOT deleted
      const memberRepo = new DrizzleMemberRepository();
      const member = await memberRepo.findById(memberB);
      expect(member!.status).toBe('active');
    } else {
      const res = await app.inject({
        method: 'POST',
        url: `/api/members/v1/subscriptions/${active.id}/cancel`,
        headers: { cookie: otherMemberCookie, origin: 'https://portal.example.test' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().subscription.cancelAtPeriodEnd).toBe(true);
    }
  });

  it('member resumes own scheduled cancellation', async () => {
    const subRepo = new DrizzleSubscriptionRepository();
    const subs = await subRepo.list({ memberId: memberB });
    const scheduled = subs.subscriptions.find((s) => s.cancelAtPeriodEnd && s.status === 'active');
    expect(scheduled).toBeTruthy();
    const res = await app.inject({
      method: 'POST',
      url: `/api/members/v1/subscriptions/${scheduled!.id}/resume`,
      headers: { cookie: otherMemberCookie, origin: 'https://portal.example.test' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().subscription.cancelAtPeriodEnd).toBe(false);
  });

  it('CSRF: state-changing member billing endpoints require valid origin', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/members/v1/billing/checkout',
      payload: { planId },
      headers: { cookie: memberCookie }, // no origin header
    });
    expect(res.statusCode).toBe(403);
  });

  // ---------- Admin ----------
  it('admin subscriptions require staff auth (401)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/v1/subscriptions' });
    expect(res.statusCode).toBe(401);
  });

  it('admin subscriptions reject member cookie (401)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/v1/subscriptions', headers: { cookie: memberCookie } });
    expect(res.statusCode).toBe(401);
  });

  it('admin can list subscriptions with permission', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/v1/subscriptions', headers: { cookie: staffCookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json().subscriptions.length).toBeGreaterThan(0);
  });

  it('admin subscription detail includes billing event history', async () => {
    const subRepo = new DrizzleSubscriptionRepository();
    const subs = await subRepo.list({ memberId: memberB });
    const res = await app.inject({ method: 'GET', url: `/api/admin/v1/subscriptions/${subs.subscriptions[0]!.id}`, headers: { cookie: staffCookie } });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().events)).toBe(true);
  });

  it('admin products require products.read (owner has it)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/v1/products', headers: { cookie: staffCookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json().products.length).toBeGreaterThan(0);
  });

  it('staff member cookie cannot access admin billing endpoints', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/v1/offers', headers: { cookie: otherMemberCookie } });
    expect(res.statusCode).toBe(401);
  });

  it('RBAC 403: staff without billing permission is denied', async () => {
    // Create a restricted staff user with a role that has NO billing permissions
    const db = getDb();
    const suffix = `${Date.now()}`;
    const uid = `u-${suffix}`;
    const email = `restricted-${suffix}@example.com`;
    const hash = await hashPassword('RestrictedPass123!');
    await db.insert(users).values({
      id: uid,
      email,
      name: 'Restricted Staff',
      slug: `restricted-${suffix}`,
      passwordHash: hash,
      status: 'active',
    });
    // Assign the 'author' role, which has no billing permissions
    const roleRows = await db.select({ id: roles.id, key: roles.key }).from(roles);
    const authorRole = roleRows.find((r) => r.key === 'author');
    if (authorRole) {
      await db.insert(userRoles).values({ userId: uid, roleId: authorRole.id });
    }
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/admin/v1/auth/login',
      payload: { email, password: 'RestrictedPass123!' },
    });
    expect(loginRes.statusCode).toBe(200);
    const staffCookie = String((loginRes.headers['set-cookie'] as unknown as string)).split(';')[0];

    const res = await app.inject({ method: 'GET', url: '/api/admin/v1/subscriptions', headers: { cookie: staffCookie } });
    expect(res.statusCode).toBe(403);
    expect(res.json().errors[0].code).toBe('PERMISSION_DENIED');
  });

  it('member subscriptions view for admin shows member subscriptions', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/admin/v1/members/${memberB}/subscriptions`, headers: { cookie: staffCookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json().subscriptions.length).toBeGreaterThan(0);
  });
});
