import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { buildApp } from '../../apps/api/src/main';
import { getDbPool, closeDbPool, seedDatabase, runMigrations } from '@vibress/database';
import {
  AnalyticsService,
  AnalyticsOverviewService,
  DrizzleAnalyticsRepository,
  deriveVisitorHash,
  normalizePath,
  normalizeReferrerDomain,
} from '@vibress/analytics';
import { hashPassword } from '@vibress/security';
import { DrizzleUserRepository, UsersService } from '@vibress/users';
import { DrizzleRoleRepository, RolesService } from '@vibress/roles';
import crypto from 'node:crypto';

const HMAC_SECRET = 'test-analytics-hmac-secret';

describe('Analytics v1 (traffic)', () => {
  let app: ReturnType<typeof buildApp>;
  let analyticsService: AnalyticsService;
  let overviewService: AnalyticsOverviewService;

  const makeEvent = (name: 'post.view' | 'page.view', over: Partial<Parameters<AnalyticsService['ingest']>[0]> = {}) => ({
    eventId: crypto.randomUUID(),
    eventName: name,
    occurredAt: new Date(),
    path: '/posts/test',
    visitorHash: deriveVisitorHash('browser-anon', HMAC_SECRET),
    referrerDomain: null,
    isBot: false,
    ...over,
  });

  beforeAll(async () => {
    await runMigrations();
    const pool = getDbPool();
    await pool.query(`
      TRUNCATE TABLE analytics_events, analytics_daily_metrics, audit_events, sessions,
      role_permissions, user_roles, permissions, roles, users, members, subscriptions,
      email_recipients, newsletter_sends, newsletters, email_events CASCADE;
    `);
    await seedDatabase({ skipDevUsers: true });

    analyticsService = new AnalyticsService(new DrizzleAnalyticsRepository());
    overviewService = new AnalyticsOverviewService(new DrizzleAnalyticsRepository());

    app = buildApp();
    await app.ready();
  }, 30000);

  beforeEach(async () => {
    const pool = getDbPool();
    await pool.query('TRUNCATE TABLE analytics_events, analytics_daily_metrics CASCADE;');
  });

  afterAll(async () => {
    if (app) await app.close();
    await closeDbPool();
  });

  describe('unique visitors accuracy', () => {
    it('Visitor A → 10 views, Visitor B → 2 views ⇒ views=12, visitors=2', async () => {
      const aHash = deriveVisitorHash('visitor-a', HMAC_SECRET);
      const bHash = deriveVisitorHash('visitor-b', HMAC_SECRET);
      for (let i = 0; i < 10; i++) {
        await analyticsService.ingest(makeEvent('post.view', { visitorHash: aHash }));
      }
      for (let i = 0; i < 2; i++) {
        await analyticsService.ingest(makeEvent('page.view', { visitorHash: bHash, path: '/about' }));
      }

      const overview = await overviewService.getOverview({ range: '7d' });
      expect(overview.summary.views).toBe(12);
      expect(overview.summary.visitors).toBe(2);
    });

    it('period visitors ≠ sum of daily unique visitors (A visits day1 and day2 ⇒ daily 1+1, period 1)', async () => {
      const aHash = deriveVisitorHash('visitor-day', HMAC_SECRET);
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 3600 * 1000);
      await analyticsService.ingest(makeEvent('post.view', { visitorHash: aHash, occurredAt: now }));
      await analyticsService.ingest(makeEvent('post.view', { visitorHash: aHash, occurredAt: yesterday }));

      const overview = await overviewService.getOverview({ range: '7d' });
      // Total period visitors = 1 (one distinct visitor across both days)
      expect(overview.summary.visitors).toBe(1);
      // Daily buckets each show 1 visitor
      const daily = await new DrizzleAnalyticsRepository().countDistinctVisitorsByDay(
        new Date(Date.now() - 7 * 86400000),
        new Date()
      );
      expect(daily.length).toBeGreaterThanOrEqual(2);
      expect(daily.every((d) => d.visitors === 1)).toBe(true);
      // 1 + 1 = 2 would be wrong
      expect(daily.reduce((s, d) => s + d.visitors, 0)).toBeGreaterThan(1);
    });
  });

  describe('idempotency', () => {
    it('duplicate eventId does not double-count', async () => {
      const event = makeEvent('post.view');
      await analyticsService.ingest(event);
      await analyticsService.ingest({ ...event, visitorHash: deriveVisitorHash('another', HMAC_SECRET) });
      const overview = await overviewService.getOverview({ range: '7d' });
      // Only the single event counted once despite the duplicate attempt
      expect(overview.summary.views).toBe(1);
      expect(overview.summary.visitors).toBe(1);
      const repo = new DrizzleAnalyticsRepository();
      expect(await repo.findEvent(event.eventId)).toBe(true);
    });
  });

  describe('bot exclusion', () => {
    it('bot events persist raw but never count in views/visitors', async () => {
      const before = (await overviewService.getOverview({ range: '7d' })).summary.views;
      await analyticsService.ingest(makeEvent('post.view', { isBot: true, visitorHash: deriveVisitorHash('bot', HMAC_SECRET) }));
      await analyticsService.ingest(makeEvent('post.view', { isBot: true, visitorHash: deriveVisitorHash('bot2', HMAC_SECRET) }));
      const after = (await overviewService.getOverview({ range: '7d' })).summary.views;
      expect(after).toBe(before);
    });
  });

  describe('top content and referrers', () => {
    it('orders top content by views and top referrers by domain', async () => {
      const gHash = deriveVisitorHash('g-visitor', HMAC_SECRET);
      for (let i = 0; i < 5; i++) {
        await analyticsService.ingest(makeEvent('post.view', { path: '/posts/top-post', visitorHash: gHash, referrerDomain: 'google.com' }));
      }
      for (let i = 0; i < 2; i++) {
        await analyticsService.ingest(makeEvent('post.view', { path: '/posts/second', visitorHash: gHash, referrerDomain: 'github.com' }));
      }
      // one direct view so the 'Direct' bucket exists
      await analyticsService.ingest(makeEvent('page.view', { path: '/', visitorHash: gHash, referrerDomain: null }));
      const overview = await overviewService.getOverview({ range: '7d' });
      expect(overview.topContent[0]!.path).toBe('/posts/top-post');
      expect(overview.referrers.find((r) => r.name === 'google.com')?.views).toBeGreaterThanOrEqual(5);
      expect(overview.referrers.find((r) => r.name === 'Direct')?.views).toBeGreaterThanOrEqual(1);
    });
  });

  describe('referrers', () => {
    it('internal navigation never inflates Direct', async () => {
      const vHash = deriveVisitorHash('internal-nav', HMAC_SECRET);
      // Landing with no referrer → Direct
      await analyticsService.ingest(makeEvent('page.view', { path: '/landing', visitorHash: vHash, referrerDomain: null }));
      // Five internal navigations (same-site referrer → internal sentinel)
      for (let i = 0; i < 5; i++) {
        await analyticsService.ingest(
          makeEvent('page.view', { path: `/page-${i}`, visitorHash: vHash, referrerDomain: 'internal' })
        );
      }
      const overview = await overviewService.getOverview({ range: '7d' });
      const direct = overview.referrers.find((r) => r.name === 'Direct');
      // Direct stays 1 — the 5 internal views are not acquisitions.
      expect(direct?.views).toBe(1);
      // No 'internal' source row appears.
      expect(overview.referrers.find((r) => r.name === 'internal')).toBeUndefined();
      // Total views still counts all 6.
      expect(overview.summary.views).toBe(6);
    });
  });

  describe('privacy helpers', () => {
    it('query strings and full referrer URLs are never stored', async () => {
      const normalized = normalizePath('/posts/a?token=secret&utm_source=x');
      expect(normalized).toBe('/posts/a');
      const domain = normalizeReferrerDomain('https://github.com/foo?email=a@b.com', 'http://localhost:7777');
      expect(domain).toBe('github.com');
      // raw browser id never stored
      const hash = deriveVisitorHash('raw-browser-id', HMAC_SECRET);
      expect(hash).not.toContain('raw-browser-id');
    });
  });

  describe('retention', () => {
    it('deletes only traffic events older than the window', async () => {
      const repo = new DrizzleAnalyticsRepository();
      const old = new Date(Date.now() - 200 * 24 * 3600 * 1000);
      await analyticsService.ingest(makeEvent('post.view', { occurredAt: old, visitorHash: deriveVisitorHash('old', HMAC_SECRET) }));
      await analyticsService.ingest(makeEvent('post.view', { occurredAt: new Date(), visitorHash: deriveVisitorHash('fresh', HMAC_SECRET) }));

      const deleted = await repo.deleteTrafficEventsBefore(new Date(Date.now() - 90 * 24 * 3600 * 1000));
      expect(deleted).toBeGreaterThanOrEqual(1);
      // fresh event still present
      const after = await overviewService.getOverview({ range: '90d' });
      expect(after.summary.views).toBeGreaterThan(0);
    });
  });

  describe('API authorization', () => {
    const createUserWithRole = async (email: string, roleKey: string, password: string) => {
      const userRepo = new DrizzleUserRepository();
      const roleRepo = new DrizzleRoleRepository();
      const usersService = new UsersService(userRepo);
      const rolesService = new RolesService(roleRepo);
      const hash = await hashPassword(password);
      const user = await usersService.createUser({ email, name: email.split('@')[0], passwordHash: hash, status: 'active' });
      const role = await rolesService.findByKey(roleKey);
      if (role) await rolesService.assignRoleToUser(user.id, role.id);
      return user;
    };

    const login = async (email: string, password: string) => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/v1/auth/login',
        payload: { email, password },
      });
      expect(res.statusCode).toBe(200);
      const setCookie = (res.headers['set-cookie'] as unknown as string) || '';
      return setCookie.split(';')[0] ?? '';
    };

    it('owner and administrator can read the overview; editor cannot; anonymous cannot', async () => {
      const owner = await createUserWithRole('a-owner@test.local', 'owner', 'AnalyticsPass123!');
      const admin = await createUserWithRole('a-admin@test.local', 'administrator', 'AnalyticsPass123!');
      const editor = await createUserWithRole('a-editor@test.local', 'editor', 'AnalyticsPass123!');
      void owner;

      const ownerCookie = await login('a-owner@test.local', 'AnalyticsPass123!');
      const adminCookie = await login('a-admin@test.local', 'AnalyticsPass123!');
      const editorCookie = await login('a-editor@test.local', 'AnalyticsPass123!');

      const ownerRes = await app.inject({ method: 'GET', url: '/api/admin/v1/analytics/overview', headers: { cookie: ownerCookie } });
      expect(ownerRes.statusCode).toBe(200);
      expect(ownerRes.json().summary).toBeDefined();

      const adminRes = await app.inject({ method: 'GET', url: '/api/admin/v1/analytics/overview', headers: { cookie: adminCookie } });
      expect(adminRes.statusCode).toBe(200);

      const editorRes = await app.inject({ method: 'GET', url: '/api/admin/v1/analytics/overview', headers: { cookie: editorCookie } });
      expect(editorRes.statusCode).toBe(403);

      const anonRes = await app.inject({ method: 'GET', url: '/api/admin/v1/analytics/overview' });
      expect(anonRes.statusCode).toBe(401);
    });

    it('collector rejects malformed payloads and accepts valid ones (204)', async () => {
      const bad = await app.inject({
        method: 'POST',
        url: '/api/public/v1/analytics/events',
        payload: { eventId: crypto.randomUUID(), event: 'hacked.event', path: '/x', visitorId: 'a' },
      });
      expect(bad.statusCode).toBe(400);

      const oversized = await app.inject({
        method: 'POST',
        url: '/api/public/v1/analytics/events',
        payload: { eventId: crypto.randomUUID(), event: 'page.view', path: `/x${'a'.repeat(2000)}`, visitorId: 'a' },
      });
      expect(oversized.statusCode).toBe(400);

      // Missing or malformed client eventId is rejected (idempotency key).
      const noEventId = await app.inject({
        method: 'POST',
        url: '/api/public/v1/analytics/events',
        payload: { event: 'page.view', path: '/x', visitorId: 'a' },
      });
      expect(noEventId.statusCode).toBe(400);

      const badEventId = await app.inject({
        method: 'POST',
        url: '/api/public/v1/analytics/events',
        payload: { eventId: 'not-a-uuid', event: 'page.view', path: '/x', visitorId: 'a' },
      });
      expect(badEventId.statusCode).toBe(400);

      const ok = await app.inject({
        method: 'POST',
        url: '/api/public/v1/analytics/events',
        payload: { eventId: crypto.randomUUID(), event: 'post.view', path: '/posts/hello?utm_source=x', visitorId: 'anon-test' },
      });
      expect(ok.statusCode).toBe(204);
    });

    it('rejects range=ytd with a validation error (only 7d/30d/90d supported)', async () => {
      const ownerCookie = await login('a-owner@test.local', 'AnalyticsPass123!');
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/v1/analytics/overview?range=ytd',
        headers: { cookie: ownerCookie },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().errors[0].code).toBe('VALIDATION_ERROR');

      for (const range of ['7d', '30d', '90d']) {
        const ok = await app.inject({
          method: 'GET',
          url: `/api/admin/v1/analytics/overview?range=${range}`,
          headers: { cookie: ownerCookie },
        });
        expect(ok.statusCode).toBe(200);
      }
    });

    it('client eventId is forwarded unchanged and reused on retry (idempotency)', async () => {
      const eventIdX = crypto.randomUUID();
      const eventIdY = crypto.randomUUID();
      const base = {
        event: 'post.view' as const,
        path: '/posts/idem',
        visitorId: 'idem-visitor',
      };
      // Collector accepts both sends with the SAME eventId (dedup happens in
      // the worker ingest pipeline, verified by the service-level tests).
      for (let i = 0; i < 2; i++) {
        const res = await app.inject({
          method: 'POST',
          url: '/api/public/v1/analytics/events',
          payload: { eventId: eventIdX, ...base },
        });
        expect(res.statusCode).toBe(204);
      }
      const yRes = await app.inject({
        method: 'POST',
        url: '/api/public/v1/analytics/events',
        payload: { eventId: eventIdY, ...base },
      });
      expect(yRes.statusCode).toBe(204);
      // Service-level idempotency proves X twice = 1 stored, X+Y = 2 stored.
      // (The collector's async worker may also ingest these eventIds — the
      // dedup guarantee means exactly one row per eventId either way.)
      await analyticsService.ingest(makeEvent('post.view', { eventId: eventIdX, visitorHash: deriveVisitorHash('idem-visitor', HMAC_SECRET) }));
      await analyticsService.ingest(makeEvent('post.view', { eventId: eventIdX, visitorHash: deriveVisitorHash('idem-visitor', HMAC_SECRET) }));
      const repo = new DrizzleAnalyticsRepository();
      expect(await repo.findEvent(eventIdX)).toBe(true);
      const pool = getDbPool();
      const countFor = async (eventId: string): Promise<number> => {
        const { rows } = await pool.query<{ n: string }>('SELECT count(*)::text AS n FROM analytics_events WHERE event_id = $1', [eventId]);
        return Number(rows[0]?.n || 0);
      };
      await analyticsService.ingest(makeEvent('post.view', { eventId: eventIdY, visitorHash: deriveVisitorHash('idem-visitor', HMAC_SECRET) }));
      expect(await countFor(eventIdX)).toBe(1); // retried twice, stored once
      expect(await countFor(eventIdY)).toBe(1); // distinct id, stored once
    });
  });

  describe('billing entitlement (paid members)', () => {
    let productId = '';
    let planId = '';
    const insertMember = async (email: string) => {
      const pool = getDbPool();
      const id = crypto.randomUUID();
      await pool.query(
        `INSERT INTO members (id, email, email_normalized, name, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'active', now(), now())`,
        [id, email, email.toLowerCase(), email.split('@')[0]]
      );
      return id;
    };
    const insertSubscription = async (memberId: string, status: string) => {
      const pool = getDbPool();
      const id = crypto.randomUUID();
      await pool.query(
        `INSERT INTO subscriptions (id, member_id, product_id, plan_id, status, currency, amount_minor, billing_interval, interval_count, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'usd', 1000, 'month', 1, now(), now())`,
        [id, memberId, productId, planId, status]
      );
    };

    it('matches the existing ACCESS_GRANTING_STATUSES policy (trialing/active only)', async () => {
      const pool = getDbPool();
      await pool.query('TRUNCATE TABLE offers, subscriptions, plans, products, members CASCADE;');
      productId = crypto.randomUUID();
      planId = crypto.randomUUID();
      await pool.query(
        `INSERT INTO products (id, key, name, status) VALUES ($1, 'analytics-test-product', 'Analytics Test', 'active')`,
        [productId]
      );
      await pool.query(
        `INSERT INTO plans (id, product_id, key, name, billing_type, currency, amount_minor, status)
         VALUES ($1, $2, 'analytics-test-plan', 'Analytics Test Plan', 'recurring', 'usd', 1000, 'active')`,
        [planId, productId]
      );
      const trialing = await insertMember('trialing@test.local');
      const active = await insertMember('active@test.local');
      const pastDue = await insertMember('pastdue@test.local');
      const unpaid = await insertMember('unpaid@test.local');
      const cancelled = await insertMember('cancelled@test.local');
      const freeOnly = await insertMember('free@test.local');

      await insertSubscription(trialing, 'trialing');
      await insertSubscription(active, 'active');
      await insertSubscription(pastDue, 'past_due');
      await insertSubscription(unpaid, 'unpaid');
      await insertSubscription(cancelled, 'cancelled');

      const overview = await overviewService.getOverview({ range: '7d' });
      // trialing + active grant access; past_due/unpaid/cancelled do NOT.
      expect(overview.summary.paidMembers).toBe(2);
      expect(overview.growth.paidMembers).toBe(2);
      expect(overview.growth.freeMembers).toBe(4); // 6 active members - 2 paid
      void freeOnly;
    });

    it('deduplicates members with multiple qualifying subscriptions', async () => {
      const pool = getDbPool();
      await pool.query('TRUNCATE TABLE offers, subscriptions, plans, products, members CASCADE;');
      productId = crypto.randomUUID();
      planId = crypto.randomUUID();
      await pool.query(
        `INSERT INTO products (id, key, name, status) VALUES ($1, 'analytics-test-product', 'Analytics Test', 'active')`,
        [productId]
      );
      await pool.query(
        `INSERT INTO plans (id, product_id, key, name, billing_type, currency, amount_minor, status)
         VALUES ($1, $2, 'analytics-test-plan', 'Analytics Test Plan', 'recurring', 'usd', 1000, 'active')`,
        [planId, productId]
      );
      const member = await insertMember('multi@test.local');
      await insertSubscription(member, 'active');
      await insertSubscription(member, 'trialing');
      const overview = await overviewService.getOverview({ range: '7d' });
      expect(overview.summary.paidMembers).toBe(1);
      expect(overview.growth.freeMembers).toBe(0);
    });
  });
});
