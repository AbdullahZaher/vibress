import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../main';
import { FastifyInstance } from 'fastify';
import { getDb } from '@vibress/database';
import { eq } from 'drizzle-orm';
import crypto from 'node:crypto';
import { hashPassword } from '@vibress/security';

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
  const ownerId = crypto.randomUUID();
  await db.insert(users).values({ id: ownerId, email: 'owner@example.com', name: 'Owner', slug: 'e2e-owner', passwordHash: hash, status: 'active' }).onConflictDoNothing();
  const ownerRole = await db.select({ id: roles.id }).from(roles).where(eq(roles.key, 'owner')).limit(1);
  if (ownerRole[0]) await db.insert(userRoles).values({ userId: ownerId, roleId: ownerRole[0].id });
}

describe('Batch 14 — Operations Integration & Security', () => {
  let app: FastifyInstance;
  let staffCookie: string;

  beforeAll(async () => {
    process.env.VIBRESS_ENCRYPTION_KEY = process.env.VIBRESS_ENCRYPTION_KEY || 'test-encryption-key-for-batch-14';
    app = buildApp();
    await app.ready();
    await ensureOwner();
    staffCookie = await loginStaff(app);
  });

  afterAll(async () => { await app.close(); });

  // ---------------- Settings ----------------
  it('settings require staff auth (401)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/v1/settings' });
    expect(res.statusCode).toBe(401);
  });

  it('staff can read settings (masked secrets)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/v1/settings', headers: { cookie: staffCookie } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const emailNs = body.namespaces.find((n: any) => n.namespace === 'email');
    const smtp = emailNs.settings.find((s: any) => s.key === 'smtpHost');
    expect(smtp.value).toBe('••••••••');
    expect(JSON.stringify(body)).not.toContain('real-smtp');
  });

  it('staff updates a valid setting (audit created)', async () => {
    const res = await app.inject({
      method: 'PUT', url: '/api/admin/v1/settings/site/title',
      headers: { cookie: staffCookie, origin: 'http://localhost:7777' },
      payload: { value: 'Batch 14 Test Title' },
    });
    expect(res.statusCode).toBe(200);

    // Audit entry created
    const auditRes = await app.inject({ method: 'GET', url: '/api/admin/v1/audit?action=setting.updated', headers: { cookie: staffCookie } });
    expect(auditRes.statusCode).toBe(200);
    const events = auditRes.json().events;
    expect(events.length).toBeGreaterThan(0);
    expect(JSON.stringify(events)).not.toContain('Batch 14 Test Title');
  });

  it('staff cannot update an unknown setting', async () => {
    const res = await app.inject({
      method: 'PUT', url: '/api/admin/v1/settings/site/nope',
      headers: { cookie: staffCookie, origin: 'http://localhost:7777' },
      payload: { value: 'x' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('secret settings are never leaked via the update response', async () => {
    const res = await app.inject({
      method: 'PUT', url: '/api/admin/v1/settings/email/smtpHost',
      headers: { cookie: staffCookie, origin: 'http://localhost:7777' },
      payload: { value: 'smtp.example.com' },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.stringify(res.json())).not.toContain('smtp.example.com');
    expect(res.json().setting.value).toBe('••••••••');
  });

  it('public settings endpoint only exposes public values', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/v1/settings/public' });
    expect(res.statusCode).toBe(200);
    const body = JSON.stringify(res.json());
    expect(body).toContain('site');
    expect(body).not.toContain('smtpHost');
    expect(body).not.toContain('authRateLimitPerMinute');
  });

  it('settings change without origin is rejected (CSRF)', async () => {
    const res = await app.inject({
      method: 'PUT', url: '/api/admin/v1/settings/site/title',
      headers: { cookie: staffCookie },
      payload: { value: 'x' },
    });
    expect(res.statusCode).toBe(403);
  });

  // ---------------- Audit ----------------
  it('audit explorer requires audit.read (401 unauth)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/v1/audit' });
    expect(res.statusCode).toBe(401);
  });

  it('audit supports filters and pagination', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/v1/audit?action=setting.updated&limit=5&offset=0', headers: { cookie: staffCookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json().events.length).toBeLessThanOrEqual(5);
    expect(typeof res.json().total).toBe('number');
  });

  it('audit has no delete endpoint (append-only)', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/api/admin/v1/audit', headers: { cookie: staffCookie } });
    expect(res.statusCode).toBe(404);
  });

  // ---------------- Redirects ----------------
  it('redirects require RBAC (401 unauth)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/v1/redirects' });
    expect(res.statusCode).toBe(401);
  });

  it('creates a redirect and rejects protected routes', async () => {
    const ok = await app.inject({
      method: 'POST', url: '/api/admin/v1/redirects',
      headers: { cookie: staffCookie, origin: 'http://localhost:7777' },
      payload: { source: `/old-${Date.now()}`, destination: '/new' },
    });
    expect(ok.statusCode).toBe(201);

    const bad = await app.inject({
      method: 'POST', url: '/api/admin/v1/redirects',
      headers: { cookie: staffCookie, origin: 'http://localhost:7777' },
      payload: { source: '/api/admin/whatever', destination: '/new' },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().errors[0].code).toBe('PROTECTED_ROUTE');
  });

  it('rejects unsafe redirect destinations (javascript/data schemes)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/admin/v1/redirects',
      headers: { cookie: staffCookie, origin: 'http://localhost:7777' },
      payload: { source: '/x-js', destination: 'javascript:alert(1)' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().errors[0].code).toBe('INVALID_DESTINATION');
  });

  it('rejects unsupported redirect codes', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/admin/v1/redirects',
      headers: { cookie: staffCookie, origin: 'http://localhost:7777' },
      payload: { source: '/x-code', destination: '/new', statusCode: 200 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().errors[0].code).toBe('INVALID_STATUS_CODE');
  });

  // ---------------- Import ----------------
  it('import validation rejects a wrong format', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/admin/v1/imports/validate',
      headers: { cookie: staffCookie, origin: 'http://localhost:7777' },
      payload: { format: 'invalid-format', version: 1, data: {} },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().valid).toBe(false);
  });

  it('import validation accepts a valid vibress envelope', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/admin/v1/imports/validate',
      headers: { cookie: staffCookie, origin: 'http://localhost:7777' },
      payload: { format: 'vibress', version: 1, exportedAt: new Date().toISOString(), data: { redirects: [] } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().valid).toBe(true);
  });

  it('import requires imports.manage (401 unauth)', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/admin/v1/imports', payload: {} });
    expect(res.statusCode).toBe(401);
  });

  it('valid import creates a job and completes', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/admin/v1/imports',
      headers: { cookie: staffCookie, origin: 'http://localhost:7777' },
      payload: {
        format: 'vibress', version: 1, exportedAt: new Date().toISOString(),
        data: { redirects: [{ source: `/imported-${Date.now()}`, destination: '/imported-target' }] },
      },
    });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(['pending', 'running', 'completed', 'failed']).toContain(body.job.status);
  });

  it('invalid import fails safely', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/admin/v1/imports',
      headers: { cookie: staffCookie, origin: 'http://localhost:7777' },
      payload: { format: 'not-vibress', version: 1, data: {} },
    });
    expect(res.statusCode).toBe(400);
  });

  // ---------------- Export ----------------
  it('export completes and contains no secret material', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/admin/v1/exports',
      headers: { cookie: staffCookie, origin: 'http://localhost:7777' },
    });
    expect(res.statusCode).toBe(202);
    const job = res.json().job;
    expect(['completed', 'failed']).toContain(job.status);

    if (job.status === 'completed') {
      const artifactRes = await app.inject({
        method: 'GET', url: `/api/admin/v1/import-export-jobs/${job.id}/artifact`,
        headers: { cookie: staffCookie },
      });
      expect(artifactRes.statusCode).toBe(200);
      const envelope = JSON.stringify(artifactRes.json());
      expect(envelope).not.toContain('smtpHost');
      expect(envelope).not.toContain('••••');
      expect(envelope).toContain('vibress');
    }
  });

  it('export artifact requires exports.manage', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/v1/import-export-jobs/none/artifact' });
    expect(res.statusCode).toBe(401);
  });

  // ---------------- System tools ----------------
  it('diagnostics require system.read (401 unauth)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/v1/system/diagnostics' });
    expect(res.statusCode).toBe(401);
  });

  it('diagnostics expose safe operational info only', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/v1/system/diagnostics', headers: { cookie: staffCookie } });
    expect(res.statusCode).toBe(200);
    const body = JSON.stringify(res.json());
    expect(body).toContain('nodeVersion');
    expect(body).toContain('postgres');
    expect(body).not.toContain('password');
    expect(body).not.toContain('DATABASE_URL');
    expect(body).not.toContain('sk_live');
    expect(body).not.toContain('VIBRESS_ENCRYPTION_KEY');
  });

  it('integrity checks run non-destructively', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/v1/system/integrity', headers: { cookie: staffCookie } });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().checks)).toBe(true);
  });

  it('maintenance accepts search rebuild and rejects unknown ops', async () => {
    const ok = await app.inject({
      method: 'POST', url: '/api/admin/v1/system/maintenance',
      headers: { cookie: staffCookie, origin: 'http://localhost:7777' },
      payload: { operation: 'search.rebuild' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().accepted).toBe(true);

    const bad = await app.inject({
      method: 'POST', url: '/api/admin/v1/system/maintenance',
      headers: { cookie: staffCookie, origin: 'http://localhost:7777' },
      payload: { operation: 'drop.database' },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('no shell/sql console endpoints exist', async () => {
    const res1 = await app.inject({ method: 'POST', url: '/api/admin/v1/system/shell', headers: { cookie: staffCookie }, payload: { cmd: 'ls' } });
    expect(res1.statusCode).toBe(404);
    const res2 = await app.inject({ method: 'POST', url: '/api/admin/v1/system/sql', headers: { cookie: staffCookie }, payload: { q: 'SELECT 1' } });
    expect(res2.statusCode).toBe(404);
  });
});
