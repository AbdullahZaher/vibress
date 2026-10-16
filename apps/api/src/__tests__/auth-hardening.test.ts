import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { FastifyInstance } from "fastify";
import { buildApp } from "../main";
import { seedDatabase } from "@vibress/database";
import { getRedisClient } from "@vibress/cache";
import * as cacheModule from "@vibress/cache";

const PROD_ENV = {
  NODE_ENV: "production",
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

describe("Task 1: Rate limiting IP resolution and account-level throttling", () => {
  const originalEnv: Record<string, string | undefined> = {};
  let app: FastifyInstance | null = null;

  beforeEach(async () => {
    for (const key of Object.keys(PROD_ENV)) {
      originalEnv[key] = process.env[key];
      process.env[key] = PROD_ENV[key as keyof typeof PROD_ENV];
    }
    await seedDatabase();
    // Clear any leftover redis throttle keys
    const redis = getRedisClient();
    const keys = await redis.keys("sys:auth_throttle:*");
    if (keys.length > 0) {
      await redis.del(...keys);
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
    delete process.env.TRUST_PROXY;
    vi.restoreAllMocks();
  });

  it("ensures spoofed XFF does not reset or evade the IP rate limit", async () => {
    app = buildApp();
    await app.ready();

    // Client real IP behind gateway (127.0.0.1) is 203.0.113.50.
    // Client attempts to spoof X-Forwarded-For by prepending rotating spoofed addresses.
    // With safe 1-hop proxy trust, Fastify resolves req.ip as 203.0.113.50 consistently.
    for (let i = 1; i <= 5; i++) {
      const res = await app.inject({
        method: "POST",
        url: "/api/admin/v1/auth/login",
        headers: {
          "x-forwarded-for": `10.99.99.${i}, 203.0.113.50`,
          origin: "https://admin.example.com",
        },
        remoteAddress: "127.0.0.1",
        payload: {
          email: `target-${i}@example.com`,
          password: "WrongPassword123!",
        },
      });
      expect(res.statusCode).toBe(401);
    }

    // 6th attempt from the same client (203.0.113.50) prepending another spoofed IP:
    // Rate limit must trigger because IP rate limiter tracks 203.0.113.50.
    const res6 = await app.inject({
      method: "POST",
      url: "/api/admin/v1/auth/login",
      headers: {
        "x-forwarded-for": "10.99.99.6, 203.0.113.50",
        origin: "https://admin.example.com",
      },
      remoteAddress: "127.0.0.1",
      payload: {
        email: "target-6@example.com",
        password: "WrongPassword123!",
      },
    });

    expect(res6.statusCode).toBe(429);
    expect(res6.json().errors[0].code).toBe("TOO_MANY_REQUESTS");
  });

  it("triggers account throttle after N failed attempts from rotating IPs", async () => {
    app = buildApp();
    await app.ready();

    // 5 failed login attempts for owner@example.com from 5 rotating client IPs:
    for (let i = 1; i <= 5; i++) {
      const res = await app.inject({
        method: "POST",
        url: "/api/admin/v1/auth/login",
        headers: {
          "x-forwarded-for": `198.51.100.${i}`,
          origin: "https://admin.example.com",
        },
        remoteAddress: "127.0.0.1",
        payload: {
          email: "owner@example.com",
          password: "WrongPassword123!",
        },
      });
      expect(res.statusCode).toBe(401);
    }

    // 6th attempt from a brand new IP (198.51.100.99):
    // Should trigger account lockout (429) regardless of rotating client IP.
    const res6 = await app.inject({
      method: "POST",
      url: "/api/admin/v1/auth/login",
      headers: {
        "x-forwarded-for": "198.51.100.99",
        origin: "https://admin.example.com",
      },
      remoteAddress: "127.0.0.1",
      payload: {
        email: "owner@example.com",
        password: "WrongPassword123!",
      },
    });

    expect(res6.statusCode).toBe(429);
    expect(res6.headers["retry-after"]).toBeDefined();
    expect(res6.json().errors[0]).toMatchObject({
      code: "TOO_MANY_REQUESTS",
      message: "Too many failed attempts. Please try again later.",
    });
  });

  it("allows legitimate login and resets the throttle counter on success", async () => {
    app = buildApp();
    await app.ready();

    // 2 failed attempts
    for (let i = 1; i <= 2; i++) {
      const failRes = await app.inject({
        method: "POST",
        url: "/api/admin/v1/auth/login",
        headers: {
          "x-forwarded-for": `198.51.100.${i}`,
          origin: "https://admin.example.com",
        },
        remoteAddress: "127.0.0.1",
        payload: {
          email: "owner@example.com",
          password: "WrongPassword123!",
        },
      });
      expect(failRes.statusCode).toBe(401);
    }

    // Successful login resets the counter
    const successRes = await app.inject({
      method: "POST",
      url: "/api/admin/v1/auth/login",
      headers: {
        "x-forwarded-for": "198.51.100.10",
        origin: "https://admin.example.com",
      },
      remoteAddress: "127.0.0.1",
      payload: {
        email: "owner@example.com",
        password: "OwnerPass123!",
      },
    });
    expect(successRes.statusCode).toBe(200);

    // Verify counter in Redis was deleted
    const redis = getRedisClient();
    const count = await redis.get(
      "sys:auth_throttle:staff_login:owner@example.com",
    );
    expect(count).toBeNull();
  });

  it("verifies behavior with a trusted proxy CIDR configured", async () => {
    // Configure TRUST_PROXY with specific CIDR range (172.16.0.0/12)
    process.env.TRUST_PROXY = "172.16.0.0/12";
    app = buildApp();
    await app.ready();

    // A: Trusted gateway (172.18.0.2) forwards client 203.0.113.10 with prepended spoof
    const trustedRes = await app.inject({
      method: "POST",
      url: "/api/admin/v1/auth/login",
      headers: {
        "x-forwarded-for": "10.0.0.1, 203.0.113.10",
        origin: "https://admin.example.com",
      },
      remoteAddress: "172.18.0.2",
      payload: {
        email: "test-trusted@example.com",
        password: "WrongPassword123!",
      },
    });
    // Request resolves properly without trusting 10.0.0.1
    expect(trustedRes.statusCode).toBe(401);

    // B: Untrusted direct peer (198.51.100.5) sends fake XFF
    // Untrusted socket is not in 172.16.0.0/12, so XFF is ignored and socket IP is used.
    for (let i = 1; i <= 5; i++) {
      await app.inject({
        method: "POST",
        url: "/api/admin/v1/auth/login",
        headers: {
          "x-forwarded-for": `9.9.9.${i}`,
          origin: "https://admin.example.com",
        },
        remoteAddress: "198.51.100.5",
        payload: {
          email: `untrusted-${i}@example.com`,
          password: "WrongPassword123!",
        },
      });
    }

    // 6th attempt from 198.51.100.5 with another fake XFF: rate limited at socket level
    const untrustedRes6 = await app.inject({
      method: "POST",
      url: "/api/admin/v1/auth/login",
      headers: {
        "x-forwarded-for": "9.9.9.6",
        origin: "https://admin.example.com",
      },
      remoteAddress: "198.51.100.5",
      payload: {
        email: "untrusted-6@example.com",
        password: "WrongPassword123!",
      },
    });
    expect(untrustedRes6.statusCode).toBe(429);
  });

  it("fails closed for login with 503 and clear log if Redis is unavailable", async () => {
    app = buildApp();
    await app.ready();

    // Mock Redis get to throw an error simulating connection failure
    const mockRedis = {
      get: vi.fn().mockRejectedValue(new Error("Connection refused: 6379")),
    };
    vi.spyOn(cacheModule, "getRedisClient").mockReturnValue(
      mockRedis as unknown as ReturnType<typeof getRedisClient>,
    );

    const res = await app.inject({
      method: "POST",
      url: "/api/admin/v1/auth/login",
      headers: {
        origin: "https://admin.example.com",
      },
      payload: {
        email: "owner@example.com",
        password: "OwnerPass123!",
      },
    });

    expect(res.statusCode).toBe(503);
    expect(res.json().errors[0]).toMatchObject({
      code: "SERVICE_UNAVAILABLE",
      message:
        "Authentication service temporarily unavailable. Please try again later.",
    });
  });

  it("enforces account throttling on member auth request and verify", async () => {
    app = buildApp();
    await app.ready();

    // 5 magic link requests for the same member email:
    for (let i = 1; i <= 5; i++) {
      const res = await app.inject({
        method: "POST",
        url: "/api/members/v1/auth/request",
        headers: {
          "x-forwarded-for": `198.51.100.${i}`,
          origin: "https://portal.example.com",
        },
        remoteAddress: "127.0.0.1",
        payload: {
          email: "member-spam@example.com",
        },
      });
      expect(res.statusCode).toBe(200);
    }

    // 6th request from another IP is throttled:
    const res6 = await app.inject({
      method: "POST",
      url: "/api/members/v1/auth/request",
      headers: {
        "x-forwarded-for": "198.51.100.99",
        origin: "https://portal.example.com",
      },
      remoteAddress: "127.0.0.1",
      payload: {
        email: "member-spam@example.com",
      },
    });
    expect(res6.statusCode).toBe(429);
    expect(res6.json().errors[0].code).toBe("TOO_MANY_REQUESTS");

    // 5 failed verify attempts on a token:
    for (let i = 1; i <= 5; i++) {
      const res = await app.inject({
        method: "POST",
        url: "/api/members/v1/auth/verify",
        headers: {
          "x-forwarded-for": `198.51.100.${i}`,
          origin: "https://portal.example.com",
        },
        remoteAddress: "127.0.0.1",
        payload: {
          token: "invalid-token-to-verify",
        },
      });
      expect(res.statusCode).toBe(400);
    }

    // 6th verify attempt for the same token is throttled:
    const verifyRes6 = await app.inject({
      method: "POST",
      url: "/api/members/v1/auth/verify",
      headers: {
        "x-forwarded-for": "198.51.100.99",
        origin: "https://portal.example.com",
      },
      remoteAddress: "127.0.0.1",
      payload: {
        token: "invalid-token-to-verify",
      },
    });
    expect(verifyRes6.statusCode).toBe(429);
    expect(verifyRes6.json().errors[0].code).toBe("TOO_MANY_REQUESTS");
  });

  it("rejects malformed Referer with 403 INVALID_ORIGIN instead of 500 error", async () => {
    app = buildApp();
    await app.ready();

    // Staff endpoint with cookie auth and malformed Referer
    const staffRes = await app.inject({
      method: "POST",
      url: "/api/admin/v1/auth/login",
      headers: {
        cookie: "vibress_session=mock-token",
        referer: "invalid-url-not-a-valid-uri",
      },
      payload: {
        email: "owner@example.com",
        password: "OwnerPass123!",
      },
    });
    expect(staffRes.statusCode).toBe(403);
    expect(staffRes.json().errors[0].code).toBe("INVALID_ORIGIN");

    // Member endpoint with cookie auth and malformed Referer
    const memberRes = await app.inject({
      method: "POST",
      url: "/api/members/v1/auth/logout",
      headers: {
        cookie: "vibress_member_session=mock-member-token",
        referer: "invalid-url-not-a-valid-uri",
      },
      payload: {},
    });
    expect(memberRes.statusCode).toBe(403);
    expect(memberRes.json().errors[0].code).toBe("INVALID_ORIGIN");
  });
});

