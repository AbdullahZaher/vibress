import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../main';

const PROD_ENV = {
  NODE_ENV: 'production',
  VIBRESS_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  NEWSLETTER_UNSUBSCRIBE_SECRET: 'newsletter-prod-secret',
  STRIPE_SECRET_KEY: 'sk_live_real',
  STRIPE_WEBHOOK_SECRET: 'whsec_real',
  CORS_ORIGINS: 'https://admin.example.com,https://portal.example.com',
  ADMIN_ORIGIN: 'https://admin.example.com',
  PORTAL_ORIGIN: 'https://portal.example.com',
};

describe('API hardening', () => {
  const originalEnv: Record<string, string | undefined> = {};
  let app: FastifyInstance | null = null;

  beforeEach(() => {
    for (const key of Object.keys(PROD_ENV)) {
      originalEnv[key] = process.env[key];
      process.env[key] = PROD_ENV[key as keyof typeof PROD_ENV];
    }
  });

  afterEach(async () => {
    if (app) {
      await app.close();
      app = null;
    }
    for (const key of Object.keys(PROD_ENV)) {
      const value = originalEnv[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    delete process.env.METRICS_ENABLED;
  });

  it('does not leak unhandled 5xx messages in production', async () => {
    app = buildApp();
    app.get('/h4/unhandled', async () => {
      throw new Error('database password leaked: postgres://secret');
    });
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/h4/unhandled' });
    expect(res.statusCode).toBe(500);
    const body = res.json();
    expect(body.errors[0]).toMatchObject({ code: 'INTERNAL_ERROR', message: 'Internal Server Error' });
    expect(res.body).not.toContain('database password leaked');
    expect(res.body).not.toContain('postgres://secret');
  });

  it('preserves explicit 4xx messages in production', async () => {
    app = buildApp();
    app.get('/h4/bad-request', async () => {
      const err = new Error('Bad input visible to client') as Error & { statusCode: number; code: string };
      err.statusCode = 400;
      err.code = 'VALIDATION_ERROR';
      throw err;
    });
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/h4/bad-request' });
    expect(res.statusCode).toBe(400);
    expect(res.json().errors[0]).toMatchObject({ code: 'VALIDATION_ERROR', message: 'Bad input visible to client' });
  });

  it('allows configured production CORS origins and rejects unknown origins', async () => {
    app = buildApp();
    await app.ready();

    const allowed = await app.inject({ method: 'GET', url: '/api', headers: { origin: 'https://admin.example.com' } });
    expect(allowed.headers['access-control-allow-origin']).toBe('https://admin.example.com');
    expect(allowed.headers['access-control-allow-credentials']).toBe('true');

    const denied = await app.inject({ method: 'GET', url: '/api', headers: { origin: 'https://evil.example.com' } });
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('enforces a strict Content Security Policy on API responses (not report-only)', async () => {
    app = buildApp();
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/api' });
    const csp = res.headers['content-security-policy'];
    expect(csp).toBeDefined();
    // Enforced, not report-only
    expect(res.headers['content-security-policy-report-only']).toBeUndefined();
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("form-action 'none'");
    // No unsafe wildcards on an API that returns JSON only
    expect(csp).not.toContain('unsafe-inline');
    expect(csp).not.toContain('unsafe-eval');
  });

  it('exposes Prometheus metrics when metrics are enabled', async () => {
    app = buildApp();
    await app.ready();

    const baseline = await app.inject({ method: 'GET', url: '/metrics' });
    const baselineCount = Number(baseline.body.match(/http_requests_total\{method="GET",path="\/api",status="2xx"\} (\d+)/)?.[1] || 0);

    const res = await app.inject({ method: 'GET', url: '/api' });
    expect(res.statusCode).toBe(200);

    const metricsRes = await app.inject({ method: 'GET', url: '/metrics' });
    expect(metricsRes.statusCode).toBe(200);
    expect(metricsRes.headers['content-type']).toContain('text/plain');
    expect(metricsRes.body).toContain('# TYPE http_requests_total counter');
    const countMatch = metricsRes.body.match(/http_requests_total\{method="GET",path="\/api",status="2xx"\} (\d+)/);
    expect(countMatch).not.toBeNull();
    expect(Number(countMatch![1])).toBe(baselineCount + 1);
    expect(metricsRes.body).toContain('nodejs_process_uptime_seconds');
  });

  it('omits the metrics endpoint when metrics are disabled', async () => {
    process.env.METRICS_ENABLED = 'false';
    app = buildApp();
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/metrics' });
    expect(res.statusCode).toBe(404);
  });
});
