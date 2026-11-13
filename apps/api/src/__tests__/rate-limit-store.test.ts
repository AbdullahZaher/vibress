import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../main";
import { getRedisClient } from "@vibress/cache";

const PROD_ENV = {
  NODE_ENV: "production",
  SITE_URL: "https://www.example.com",
  VIBRESS_ENCRYPTION_KEY:
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  NEWSLETTER_UNSUBSCRIBE_SECRET: "newsletter-prod-secret",
  STRIPE_SECRET_KEY: "sk_live_real",
  STRIPE_WEBHOOK_SECRET: "whsec_real",
  CORS_ORIGINS: "https://admin.example.com,https://portal.example.com",
  ADMIN_ORIGIN: "https://admin.example.com",
  PORTAL_ORIGIN: "https://portal.example.com",
  VIBRESS_SETUP_TOKEN: "prod-setup-token-0123456789abcdef0123456789abcdef",
};

describe("F-013: rate-limit counters are shared through Redis", () => {
  const originalEnv: Record<string, string | undefined> = {};
  let appA: FastifyInstance | null = null;
  let appB: FastifyInstance | null = null;

  const clearLimiterKeys = async () => {
    const redis = getRedisClient();
    const keys = await redis.keys("vibress:rate-limit:*");
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  };

  const acceptInvitation = (app: FastifyInstance) =>
    app.inject({
      method: "POST",
      url: "/api/admin/v1/auth/invitation/accept",
      headers: {
        "x-forwarded-for": "198.51.100.77",
        origin: "https://admin.example.com",
      },
      remoteAddress: "198.51.100.77",
      payload: {
        token: "not-a-real-invitation-token",
        password: "ValidPassword123!",
      },
    });

  beforeAll(async () => {
    for (const key of Object.keys(PROD_ENV)) {
      originalEnv[key] = process.env[key];
      process.env[key] = PROD_ENV[key as keyof typeof PROD_ENV];
    }
    appA = buildApp();
    appB = buildApp();
    await appA.ready();
    await appB.ready();
    await clearLimiterKeys();
  });

  beforeEach(async () => {
    await clearLimiterKeys();
  });

  afterAll(async () => {
    await clearLimiterKeys();
    if (appA) await appA.close();
    if (appB) await appB.close();
    for (const key of Object.keys(PROD_ENV)) {
      const value = originalEnv[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it("rejects the sixth invitation request on a second API instance", async () => {
    for (let i = 0; i < 5; i++) {
      const res = await acceptInvitation(appA!);
      expect(res.statusCode).toBe(400);
    }

    const limited = await acceptInvitation(appA!);
    expect(limited.statusCode).toBe(429);
    expect(limited.json().errors[0].code).toBe("TOO_MANY_REQUESTS");

    const otherInstance = await acceptInvitation(appB!);
    expect(otherInstance.statusCode).toBe(429);
  });

  it("writes limiter counters to the shared Redis namespace with a TTL", async () => {
    await acceptInvitation(appA!);

    const redis = getRedisClient();
    const keys = await redis.keys("vibress:rate-limit:*");
    expect(keys.length).toBeGreaterThan(0);
    expect(await redis.pttl(keys[0]!)).toBeGreaterThan(0);
  });
});
