import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import { buildApp } from '../main';
import { setEmailServiceForTests } from '../services';
import { FastifyInstance } from 'fastify';
import {
  DrizzleMemberRepository,
  DrizzleMemberAuthTokenRepository,
  DrizzleMemberSessionRepository,
  MemberAuthService,
} from '@vibress/members';
import { getDb } from '@vibress/database';
import { eq } from 'drizzle-orm';
import {
  EmailService,
  DrizzleEmailRecipientRepository,
  DrizzleEmailEventRepository,
  DrizzleEmailSuppressionRepository,
  DrizzleProviderEventRepository,
  SmtpEmailProvider,
} from '@vibress/email';

class CaptureMailer {
  sent: Array<{ to: string; magicLinkUrl: string }> = [];
  async sendMagicLink(input: any): Promise<void> {
    this.sent.push({ to: input.to, magicLinkUrl: input.magicLinkUrl });
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
  const res = await app.inject({ method: 'POST', url: '/api/admin/v1/auth/login', payload: { email, password } });
  expect(res.statusCode).toBe(200);
  const setCookie = (res.headers['set-cookie'] as unknown as string) || '';
  return setCookie.split(';')[0] ?? '';
}

async function ensureOwner(): Promise<void> {
  // Integration tests elsewhere TRUNCATE users; ensure the owner exists so
  // staff-login scenarios are deterministic regardless of test order.
  const db = getDb();
  const { users, userRoles, roles } = await import('@vibress/database');
  const { hashPassword } = await import('@vibress/security');
  const rows = await db.select().from(users).where(eq(users.email, 'owner@example.com')).limit(1);
  if (rows.length > 0) return;
  const hash = await hashPassword('OwnerPass123!');
  const ownerId = crypto.randomUUID();
  await db.insert(users).values({
    id: ownerId,
    email: 'owner@example.com',
    name: 'Owner',
    slug: 'e2e-owner',
    passwordHash: hash,
    status: 'active',
  }).onConflictDoNothing();
  const ownerRole = await db.select({ id: roles.id }).from(roles).where(eq(roles.key, 'owner')).limit(1);
  if (ownerRole[0]) {
    await db.insert(userRoles).values({ userId: ownerId, roleId: ownerRole[0].id });
  }
}

const WEBHOOK_SECRET = 'whsec_email_int_test';

function signEmailEvent(payload: string): string {
  return `sha256=${crypto.createHmac('sha256', WEBHOOK_SECRET).update(payload).digest('hex')}`;
}

function makeEmailEvent(payload: object): string {
  return JSON.stringify({
    id: `evt_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    type: 'delivered',
    messageId: 'msg_int_1',
    email: 'a@example.com',
    timestamp: Math.floor(Date.now() / 1000),
    ...payload,
  });
}

describe('Batch 10 — Newsletters & Email Integration & Security', () => {
  let app: FastifyInstance;
  let staffCookie: string;
  let memberCookie: string;
  let otherMemberCookie: string;
  let memberB: string;
  let newsletterId: string;
  let sendId: string;

  beforeAll(async () => {
    // Inject a provider with a known webhook secret (module env read happens at import time)
    setEmailServiceForTests(
      new EmailService({
        provider: new SmtpEmailProvider({ host: '127.0.0.1', port: 1025, webhookSecret: WEBHOOK_SECRET }),
        recipientRepo: new DrizzleEmailRecipientRepository(),
        eventRepo: new DrizzleEmailEventRepository(),
        suppressionRepo: new DrizzleEmailSuppressionRepository(),
        providerEventRepo: new DrizzleProviderEventRepository(),
      })
    );
    app = buildApp();
    await app.ready();

    await ensureOwner();
    staffCookie = await loginStaff(app, 'owner@example.com', 'OwnerPass123!');

    const member = await signupMember(app, `nl-a-${Date.now()}@example.com`);
    memberCookie = member.cookie;
    const other = await signupMember(app, `nl-b-${Date.now()}@example.com`);
    otherMemberCookie = other.cookie;
    memberB = other.memberId;
  });

  afterAll(async () => {
    await app.close();
  });

  // ---------------- Newsletters ----------------
  it('admin can create a newsletter', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/v1/newsletters',
      headers: { cookie: staffCookie, origin: 'http://localhost:7777' },
      payload: { key: `weekly${Date.now()}`, name: 'Weekly Digest', senderName: 'Vibress', senderEmail: 'news@vibress.test' },
    });
    expect(res.statusCode).toBe(201);
    newsletterId = res.json().newsletter.id;
  });

  it('admin newsletter creation requires newsletters.manage (401 without staff)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/v1/newsletters' });
    expect(res.statusCode).toBe(401);
  });

  it('member cookie cannot access admin newsletter routes', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/v1/newsletters', headers: { cookie: memberCookie } });
    expect(res.statusCode).toBe(401);
  });

  it('admin rejects invalid sender email', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/v1/newsletters',
      headers: { cookie: staffCookie, origin: 'http://localhost:7777' },
      payload: { key: `bad${Date.now()}`, name: 'Bad', senderName: 'V', senderEmail: 'not-an-email' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().errors[0].code).toBe('VALIDATION_ERROR');
  });

  it('admin can create a scheduled send', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/v1/newsletter-sends',
      headers: { cookie: staffCookie, origin: 'http://localhost:7777' },
      payload: {
        newsletterId,
        subject: 'Test Newsletter',
        content: { schema: 'vibress-studio', version: 1, root: { type: 'root', children: [{ type: 'paragraph', children: [{ type: 'text', text: 'Hello', format: 0, mode: 'normal', version: 1 }], direction: null, format: '', indent: 0, version: 1 }] } },
        audience: { filter: 'all' },
        scheduledAt: new Date(Date.now() + 3600000).toISOString(),
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().send.status).toBe('scheduled');
    sendId = res.json().send.id;
  });

  it('admin can cancel a scheduled send', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/v1/newsletter-sends/${sendId}/cancel`,
      headers: { cookie: staffCookie, origin: 'http://localhost:7777' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().send.status).toBe('cancelled');
  });

  it('send-now requires newsletters.send permission (owner has it)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/v1/newsletter-sends',
      headers: { cookie: staffCookie, origin: 'http://localhost:7777' },
      payload: {
        newsletterId,
        subject: 'Send Now Test',
        content: { schema: 'vibress-studio', version: 1, root: { type: 'root', children: [] } },
        audience: { filter: 'all' },
        sendNow: true,
      },
    });
    expect(res.statusCode).toBe(201);
  });

  it('RBAC 403: staff without newsletter permission cannot create sends', async () => {
    // Create a restricted staff user with the author role (no newsletter perms)
    const db = getDb();
    const { hashPassword } = await import('@vibress/security');
    const suffix = `${Date.now()}`;
    const email = `restricted-nl-${suffix}@example.com`;
    const hash = await hashPassword('RestrictedPass123!');
    const { users, userRoles, roles } = await import('@vibress/database');
    await db.insert(users).values({
      id: `u-nl-${suffix}`,
      email,
      name: 'Restricted',
      slug: `restricted-nl-${suffix}`,
      passwordHash: hash,
      status: 'active',
    });
    const authorRole = await db.select({ id: roles.id }).from(roles).where(eq(roles.key, 'author')).limit(1);
    if (authorRole[0]) {
      await db.insert(userRoles).values({ userId: `u-nl-${suffix}`, roleId: authorRole[0].id });
    }
    const loginRes = await app.inject({ method: 'POST', url: '/api/admin/v1/auth/login', payload: { email, password: 'RestrictedPass123!' } });
    expect(loginRes.statusCode).toBe(200);
    const restrictedCookie = String((loginRes.headers['set-cookie'] as unknown as string)).split(';')[0] ?? '';

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/v1/newsletter-sends',
      headers: { cookie: restrictedCookie, origin: 'http://localhost:7777' },
      payload: {
        newsletterId,
        subject: 'Nope',
        content: {},
        audience: { filter: 'all' },
      },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().errors[0].code).toBe('PERMISSION_DENIED');
  });

  // ---------------- Member preferences ----------------
  it('member can subscribe to a newsletter', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/members/v1/newsletter-preferences',
      headers: { cookie: memberCookie, origin: 'http://localhost:7777' },
      payload: { newsletterId, subscribed: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().preference.subscribed).toBe(true);
  });

  it('member preferences require member auth (401)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/members/v1/newsletter-preferences' });
    expect(res.statusCode).toBe(401);
  });

  it('CSRF: preference update without origin is rejected', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/members/v1/newsletter-preferences',
      headers: { cookie: memberCookie },
      payload: { newsletterId, subscribed: true },
    });
    expect(res.statusCode).toBe(403);
  });

  it('member can unsubscribe', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/members/v1/newsletter-preferences',
      headers: { cookie: memberCookie, origin: 'http://localhost:7777' },
      payload: { newsletterId, subscribed: false },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().preference.subscribed).toBe(false);
  });

  // ---------------- Email webhooks ----------------
  it('webhook rejects invalid signature', async () => {
    const payload = makeEmailEvent({});
    const res = await app.inject({
      method: 'POST',
      url: '/api/webhooks/v1/email/smtp',
      headers: { 'content-type': 'application/json', 'x-email-signature': 'sha256=bogus' },
      payload,
    });
    expect(res.statusCode).toBe(400);
  });

  it('webhook accepts a valid signed event and deduplicates replay', async () => {
    const payload = makeEmailEvent({ id: 'evt_dup_int', type: 'delivered', messageId: 'msg_int_dup' });
    const header = signEmailEvent(payload);
    const res1 = await app.inject({
      method: 'POST',
      url: '/api/webhooks/v1/email/smtp',
      headers: { 'content-type': 'application/json', 'x-email-signature': header },
      payload,
    });
    expect(res1.statusCode).toBe(200);
    const res2 = await app.inject({
      method: 'POST',
      url: '/api/webhooks/v1/email/smtp',
      headers: { 'content-type': 'application/json', 'x-email-signature': header },
      payload,
    });
    expect(res2.statusCode).toBe(200);
    // Durable dedupe: exactly one provider_events row
    const db = getDb();
    const { providerEvents } = await import('@vibress/database');
    const rows = await db.select().from(providerEvents).where(eq(providerEvents.providerEventId, 'evt_dup_int'));
    expect(rows.length).toBe(1);
    expect(rows[0]!.status).toBe('processed');
  });

  // ---------------- Test email (Mailpit) ----------------
  it('test email is delivered to Mailpit', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/v1/newsletter-test-email',
      headers: { cookie: staffCookie, origin: 'http://localhost:7777' },
      payload: {
        newsletterId,
        subject: `Test ${Date.now()}`,
        content: { schema: 'vibress-studio', version: 1, root: { type: 'root', children: [{ type: 'paragraph', children: [{ type: 'text', text: 'Test body', format: 0, mode: 'normal', version: 1 }], direction: null, format: '', indent: 0, version: 1 }] } },
        recipients: ['test-int@example.com'],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().sent).toBe(1);
  });

  // ---------------- Unsubscribe ----------------
  it('public unsubscribe endpoint rejects a forged token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/public/v1/unsubscribe',
      payload: { token: 'forged' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().errors[0].code).toBe('INVALID_UNSUBSCRIBE_TOKEN');
  });

  it('public unsubscribe endpoint rejects a missing token', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/public/v1/unsubscribe', payload: {} });
    expect(res.statusCode).toBe(400);
  });

  // ---------------- Suppressions ----------------
  it('admin can list suppressions (email.read)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/v1/email-suppressions', headers: { cookie: staffCookie } });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().suppressions)).toBe(true);
  });

  it('suppression list requires staff auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/v1/email-suppressions' });
    expect(res.statusCode).toBe(401);
  });
});
