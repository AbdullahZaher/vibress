import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../main';
import { FastifyInstance } from 'fastify';
import {
  DrizzleMemberRepository,
  DrizzleMemberAuthTokenRepository,
  DrizzleMemberSessionRepository,
  MemberAuthService,
} from '@vibress/members';
import { getDb } from '@vibress/database';
import { eq } from 'drizzle-orm';
import { hashPassword } from '@vibress/security';

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
    memberRepo, new DrizzleMemberAuthTokenRepository(), new DrizzleMemberSessionRepository(), mailer, () => true
  );
  await authService.requestAuthLink(email);
  const link = mailer.sent[0]?.magicLinkUrl;
  if (!link) throw new Error('no magic link');
  const token = new URL(link).searchParams.get('token') || '';
  const res = await app.inject({ method: 'POST', url: '/api/members/v1/auth/verify', payload: { token } });
  expect(res.statusCode).toBe(200);
  const body = res.json();
  const setCookie = (res.headers['set-cookie'] as unknown as string) || '';
  return { memberId: String(body.member?.id ?? ''), cookie: setCookie.split(';')[0] ?? '' };
}

async function loginStaff(app: FastifyInstance): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/admin/v1/auth/login', payload: { email: 'owner@example.com', password: 'OwnerPass123!' } });
  expect(res.statusCode).toBe(200);
  const setCookie = (res.headers['set-cookie'] as unknown as string) || '';
  return setCookie.split(';')[0] ?? '';
}

async function ensureOwner(): Promise<void> {
  const db = getDb();
  const { users, userRoles, roles } = await import('@vibress/database');
  const rows = await db.select().from(users).where(eq(users.email, 'owner@example.com')).limit(1);
  if (rows.length > 0) return;
  const hash = await hashPassword('OwnerPass123!');
  const ownerId = `owner-${Date.now()}`;
  await db.insert(users).values({ id: ownerId, email: 'owner@example.com', name: 'Owner', slug: 'e2e-owner', passwordHash: hash, status: 'active' });
  const ownerRole = await db.select({ id: roles.id }).from(roles).where(eq(roles.key, 'owner')).limit(1);
  if (ownerRole[0]) await db.insert(userRoles).values({ userId: ownerId, roleId: ownerRole[0].id });
}

async function ensurePost(): Promise<string> {
  const db = getDb();
  const { posts } = await import('@vibress/database');
  const existing = await db.select().from(posts).where(eq(posts.slug, 'community-test-post')).limit(1);
  if (existing[0]) return existing[0].id;
  const { users } = await import('@vibress/database');
  const ownerRows = await db.select().from(users).where(eq(users.email, 'owner@example.com')).limit(1);
  const ownerId = ownerRows[0]?.id || 'unknown';
  const [row] = await db.insert(posts).values({
    id: `post-community-${Date.now()}`,
    title: 'Community Test Post',
    slug: 'community-test-post',
    content: { schema: 'vibress-studio', version: 1, root: { type: 'root', children: [] } },
    status: 'published',
    visibility: 'public',
    primaryAuthorId: ownerId,
    createdBy: ownerId,
    updatedBy: ownerId,
  }).returning();
  return row!.id;
}

describe('Batch 11 — Community Integration & Security', () => {
  let app: FastifyInstance;
  let staffCookie: string;
  let memberA: { memberId: string; cookie: string };
  let memberB: { memberId: string; cookie: string };
  let postId: string;
  let commentA: string;

  beforeAll(async () => {
    app = buildApp();
    await app.ready();
    await ensureOwner();
    staffCookie = await loginStaff(app);
    postId = await ensurePost();
    const suffix = `${Date.now()}`;
    memberA = await signupMember(app, `comm-a-${suffix}@example.com`);
    memberB = await signupMember(app, `comm-b-${suffix}@example.com`);
  });

  afterAll(async () => { await app.close(); });

  // ---------------- Comments: create, reply, edit-own, IDOR ----------------
  it('member creates a comment', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/members/v1/comments',
      headers: { cookie: memberA.cookie, origin: 'http://localhost:7777' },
      payload: { postId, body: 'Hello world' },
    });
    expect(res.statusCode).toBe(201);
    commentA = res.json().comment.id;
  });

  it('stored XSS is sanitized: HTML tags stripped', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/members/v1/comments',
      headers: { cookie: memberA.cookie, origin: 'http://localhost:7777' },
      payload: { postId, body: '<script>alert("xss")</script>Hello' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().comment.body).toBe('alert("xss")Hello');
  });

  it('public API lists published comments (no hidden/deleted)', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/content/v1/posts/${postId}/comments` });
    expect(res.statusCode).toBe(200);
    for (const c of res.json().comments) {
      expect(c.status).toBe('published');
    }
  });

  it('member creates a reply (threaded)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/members/v1/comments',
      headers: { cookie: memberB.cookie, origin: 'http://localhost:7777' },
      payload: { postId, parentId: commentA, body: 'Nice reply' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().comment.parentId).toBe(commentA);
  });

  it('IDOR: member B cannot edit member A comment', async () => {
    const res = await app.inject({
      method: 'PATCH', url: `/api/members/v1/comments/${commentA}`,
      headers: { cookie: memberB.cookie, origin: 'http://localhost:7777' },
      payload: { body: 'hacked' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('IDOR: member B cannot delete member A comment', async () => {
    const res = await app.inject({
      method: 'DELETE', url: `/api/members/v1/comments/${commentA}`,
      headers: { cookie: memberB.cookie, origin: 'http://localhost:7777' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('member A edits own comment', async () => {
    const res = await app.inject({
      method: 'PATCH', url: `/api/members/v1/comments/${commentA}`,
      headers: { cookie: memberA.cookie, origin: 'http://localhost:7777' },
      payload: { body: 'Updated text' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().comment.body).toBe('Updated text');
  });

  it('CSRF: comment without origin is rejected', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/members/v1/comments',
      headers: { cookie: memberA.cookie },
      payload: { postId, body: 'no origin' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('unauthenticated comment POST is rejected', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/members/v1/comments', payload: { postId, body: 'anon' } });
    expect(res.statusCode).toBe(401);
  });

  // ---------------- Likes ----------------
  it('member likes a comment', async () => {
    const res = await app.inject({
      method: 'POST', url: `/api/members/v1/comments/${commentA}/like`,
      headers: { cookie: memberB.cookie, origin: 'http://localhost:7777' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().liked).toBe(true);
  });

  it('member unlikes (toggle)', async () => {
    const res = await app.inject({
      method: 'POST', url: `/api/members/v1/comments/${commentA}/like`,
      headers: { cookie: memberB.cookie, origin: 'http://localhost:7777' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().liked).toBe(false);
  });

  // ---------------- Reports + spam protection ----------------
  it('member reports a comment', async () => {
    const res = await app.inject({
      method: 'POST', url: `/api/members/v1/comments/${commentA}/report`,
      headers: { cookie: memberB.cookie, origin: 'http://localhost:7777' },
      payload: { reason: 'inappropriate' },
    });
    expect(res.statusCode).toBe(201);
  });

  it('report spam: same member cannot report twice', async () => {
    const res = await app.inject({
      method: 'POST', url: `/api/members/v1/comments/${commentA}/report`,
      headers: { cookie: memberB.cookie, origin: 'http://localhost:7777' },
      payload: { reason: 'duplicate' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().errors[0].code).toBe('ALREADY_REPORTED');
  });

  // ---------------- Notifications ----------------
  it('reply generates notification for parent author', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/members/v1/notifications', headers: { cookie: memberA.cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json().notifications.length).toBeGreaterThan(0);
    const replyNotif = res.json().notifications.find((n: any) => n.type === 'comment.reply');
    expect(replyNotif).toBeTruthy();
  });

  it('notification isolation: member B cannot see member A notifications', async () => {
    const resA = await app.inject({ method: 'GET', url: '/api/members/v1/notifications', headers: { cookie: memberA.cookie } });
    const resB = await app.inject({ method: 'GET', url: '/api/members/v1/notifications', headers: { cookie: memberB.cookie } });
    const aIds = new Set(resA.json().notifications.map((n: any) => n.id));
    const bIds = new Set(resB.json().notifications.map((n: any) => n.id));
    for (const id of aIds) expect(bIds.has(id)).toBe(false);
  });

  it('unread count works', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/members/v1/notifications/unread-count', headers: { cookie: memberA.cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json().count).toBeGreaterThan(0);
  });

  it('mark one read', async () => {
    const listRes = await app.inject({ method: 'GET', url: '/api/members/v1/notifications', headers: { cookie: memberA.cookie } });
    const firstUnread = listRes.json().notifications.find((n: any) => !n.readAt);
    if (firstUnread) {
      const res = await app.inject({ method: 'POST', url: `/api/members/v1/notifications/${firstUnread.id}/read`, headers: { cookie: memberA.cookie, origin: 'http://localhost:7777' } });
      expect(res.statusCode).toBe(200);
    }
  });

  it('mark all read', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/members/v1/notifications/read-all', headers: { cookie: memberA.cookie, origin: 'http://localhost:7777' } });
    expect(res.statusCode).toBe(200);
    const countRes = await app.inject({ method: 'GET', url: '/api/members/v1/notifications/unread-count', headers: { cookie: memberA.cookie } });
    expect(countRes.json().count).toBe(0);
  });

  it('notifications require member auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/members/v1/notifications' });
    expect(res.statusCode).toBe(401);
  });

  // ---------------- Admin moderation ----------------
  it('admin hides a comment (401 without auth)', async () => {
    const res = await app.inject({ method: 'POST', url: `/api/admin/v1/comments/${commentA}/hide` });
    expect(res.statusCode).toBe(401);
  });

  it('admin hides a comment with permission', async () => {
    const res = await app.inject({
      method: 'POST', url: `/api/admin/v1/comments/${commentA}/hide`,
      headers: { cookie: staffCookie, origin: 'http://localhost:7777' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().comment.status).toBe('hidden');
  });

  it('hidden comment disappears from public API', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/content/v1/posts/${postId}/comments` });
    const ids = res.json().comments.map((c: any) => c.id);
    expect(ids).not.toContain(commentA);
  });

  it('admin restores the comment', async () => {
    const res = await app.inject({
      method: 'POST', url: `/api/admin/v1/comments/${commentA}/restore`,
      headers: { cookie: staffCookie, origin: 'http://localhost:7777' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().comment.status).toBe('published');
  });

  it('admin can list reports', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/v1/comment-reports', headers: { cookie: staffCookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json().reports.length).toBeGreaterThan(0);
  });

  it('member cookie cannot access admin moderation (401)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/v1/comments', headers: { cookie: memberA.cookie } });
    expect(res.statusCode).toBe(401);
  });

  // ---------------- Recommendations ----------------
  it('admin creates a recommendation with a safe URL', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/admin/v1/recommendations',
      headers: { cookie: staffCookie, origin: 'http://localhost:7777' },
      payload: { url: 'https://example.com/article', title: 'Great Article' },
    });
    expect(res.statusCode).toBe(201);
  });

  it('recommendation SSRF: localhost URL rejected', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/admin/v1/recommendations',
      headers: { cookie: staffCookie, origin: 'http://localhost:7777' },
      payload: { url: 'http://localhost:8080/internal', title: 'Internal' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().errors[0].code).toBe('UNSAFE_URL');
  });

  it('recommendation SSRF: private IP rejected', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/admin/v1/recommendations',
      headers: { cookie: staffCookie, origin: 'http://localhost:7777' },
      payload: { url: 'http://192.168.1.1/admin', title: 'Private' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().errors[0].code).toBe('UNSAFE_URL');
  });

  it('recommendation SSRF: non-http protocol rejected', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/admin/v1/recommendations',
      headers: { cookie: staffCookie, origin: 'http://localhost:7777' },
      payload: { url: 'file:///etc/passwd', title: 'File' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('public can list active recommendations', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/content/v1/recommendations' });
    expect(res.statusCode).toBe(200);
    expect(res.json().recommendations.length).toBeGreaterThan(0);
  });

  it('public click tracking records an event', async () => {
    const listRes = await app.inject({ method: 'GET', url: '/api/content/v1/recommendations' });
    const recId = listRes.json().recommendations[0].id;
    const res = await app.inject({ method: 'POST', url: `/api/content/v1/recommendations/${recId}/click`, payload: { sessionId: 'test-session' } });
    expect(res.statusCode).toBe(200);
    const statsRes = await app.inject({ method: 'GET', url: `/api/admin/v1/recommendations/${recId}/stats`, headers: { cookie: staffCookie } });
    expect(statsRes.json().stats.click).toBeGreaterThanOrEqual(1);
  });
});
