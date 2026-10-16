import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { FastifyInstance } from "fastify";
import { buildApp } from "../main";
import { seedDatabase } from "@vibress/database";
import { getRedisClient, buildSystemCacheKey } from "@vibress/cache";
import * as cacheModule from "@vibress/cache";
import {
  recordAccountFailure,
  resetAccountThrottle,
  checkAccountThrottle,
  normalizeClientSubnet,
} from "../helpers/account-throttle";
import { appLogger } from "../observability";

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
    await seedDatabase({ skipDevUsers: false });
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

  it("ensures an attacker IP cannot lock out the owner logging in from a different IP", async () => {
    app = buildApp();
    await app.ready();

    // Attacker sends 5 bad passwords for owner@example.com from 198.51.100.1:
    for (let i = 1; i <= 5; i++) {
      const res = await app.inject({
        method: "POST",
        url: "/api/admin/v1/auth/login",
        headers: {
          "x-forwarded-for": "198.51.100.1",
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

    // 6th attempt from attacker IP (198.51.100.1) is locked (429):
    const attackerRes6 = await app.inject({
      method: "POST",
      url: "/api/admin/v1/auth/login",
      headers: {
        "x-forwarded-for": "198.51.100.1",
        origin: "https://admin.example.com",
      },
      remoteAddress: "127.0.0.1",
      payload: {
        email: "owner@example.com",
        password: "WrongPassword123!",
      },
    });
    expect(attackerRes6.statusCode).toBe(429);
    expect(attackerRes6.json().errors[0].code).toBe("TOO_MANY_REQUESTS");

    // Legitimate owner logs in from a different IP (203.0.113.10) with valid credentials:
    // MUST NOT be locked out by attacker's brute force attempts.
    const ownerRes = await app.inject({
      method: "POST",
      url: "/api/admin/v1/auth/login",
      headers: {
        "x-forwarded-for": "203.0.113.10",
        origin: "https://admin.example.com",
      },
      remoteAddress: "127.0.0.1",
      payload: {
        email: "owner@example.com",
        password: "OwnerPass123!",
      },
    });
    expect(ownerRes.statusCode).toBe(200);
    expect(ownerRes.json().user.email).toBe("owner@example.com");
  });

  it("still triggers legitimate lockout for a single attacker IP after 5 failed attempts", async () => {
    app = buildApp();
    await app.ready();

    for (let i = 1; i <= 5; i++) {
      const res = await app.inject({
        method: "POST",
        url: "/api/admin/v1/auth/login",
        headers: {
          "x-forwarded-for": "198.51.100.5",
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

    const res6 = await app.inject({
      method: "POST",
      url: "/api/admin/v1/auth/login",
      headers: {
        "x-forwarded-for": "198.51.100.5",
        origin: "https://admin.example.com",
      },
      remoteAddress: "127.0.0.1",
      payload: {
        email: "owner@example.com",
        password: "WrongPassword123!",
      },
    });
    expect(res6.statusCode).toBe(429);
    expect(res6.json().errors[0].code).toBe("TOO_MANY_REQUESTS");
  });

  it("behaves identically for unknown emails to prevent account enumeration", async () => {
    app = buildApp();
    await app.ready();

    // 5 attempts for a nonexistent email from attacker IP
    for (let i = 1; i <= 5; i++) {
      const res = await app.inject({
        method: "POST",
        url: "/api/admin/v1/auth/login",
        headers: {
          "x-forwarded-for": "198.51.100.7",
          origin: "https://admin.example.com",
        },
        remoteAddress: "127.0.0.1",
        payload: {
          email: "nonexistent-user@example.com",
          password: "WrongPassword123!",
        },
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().errors[0]).toMatchObject({
        code: "INVALID_CREDENTIALS",
        message: "Invalid credentials",
      });
    }

    // 6th attempt is throttled identically
    const res6 = await app.inject({
      method: "POST",
      url: "/api/admin/v1/auth/login",
      headers: {
        "x-forwarded-for": "198.51.100.7",
        origin: "https://admin.example.com",
      },
      remoteAddress: "127.0.0.1",
      payload: {
        email: "nonexistent-user@example.com",
        password: "WrongPassword123!",
      },
    });
    expect(res6.statusCode).toBe(429);
    expect(res6.json().errors[0].code).toBe("TOO_MANY_REQUESTS");
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
          "x-forwarded-for": "198.51.100.10",
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
      "sys:auth_throttle:staff_login:owner@example.com:198.51.100.0/24",
    );
    expect(count).toBeNull();
    const globalCount = await redis.get(
      "sys:auth_throttle:staff_login_global:owner@example.com",
    );
    expect(globalCount).toBeNull();
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
    const retryAfter = Number.parseInt(
      res6.headers["retry-after"] as string,
      10,
    );
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(600);

    const redis = getRedisClient();
    const memberReqTtl = await redis.ttl(
      buildSystemCacheKey(
        "auth_throttle",
        "member_request:member-spam@example.com",
      ),
    );
    expect(memberReqTtl).toBeGreaterThan(0);
    expect(memberReqTtl).toBeLessThanOrEqual(600);

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

  it("ensures throttle keys always possess a positive TTL after failure recording (no permanent lockout)", async () => {
    const redis = getRedisClient();
    const testScope = "staff_login";
    const testEmail = "test-atomic-ttl@example.com";
    const testIp = "192.0.2.77";

    // 1. Initial recorded failure on non-existent key atomically assigns TTL
    const count1 = await recordAccountFailure(testScope, testEmail, {
      clientIp: testIp,
    });
    expect(count1).toBe(1);

    const subnet = normalizeClientSubnet(testIp);
    const key = buildSystemCacheKey(
      "auth_throttle",
      `staff_login:${testEmail}:${subnet}`,
    );
    const initialTtl = await redis.ttl(key);
    expect(initialTtl).toBeGreaterThan(0);
    expect(initialTtl).toBeLessThanOrEqual(900);

    // 2. Pre-existing key without TTL (ttl == -1) is healed on subsequent recorded failure
    await redis.persist(key);
    expect(await redis.ttl(key)).toBe(-1);

    const count2 = await recordAccountFailure(testScope, testEmail, {
      clientIp: testIp,
    });
    expect(count2).toBe(2);

    const healedTtl = await redis.ttl(key);
    expect(healedTtl).toBeGreaterThan(0);
    expect(healedTtl).toBeLessThanOrEqual(900);

    // 3. Reaching lockout threshold assigns lockout TTL > 0
    await recordAccountFailure(testScope, testEmail, { clientIp: testIp });
    await recordAccountFailure(testScope, testEmail, { clientIp: testIp });
    const count5 = await recordAccountFailure(testScope, testEmail, {
      clientIp: testIp,
    });
    expect(count5).toBe(5);

    const lockoutTtl = await redis.ttl(key);
    expect(lockoutTtl).toBeGreaterThan(0);
    expect(lockoutTtl).toBeLessThanOrEqual(900);

    // Clean up
    await resetAccountThrottle(testScope, testEmail, { clientIp: testIp });
  });

  it("logs a startup security warning when TRUST_PROXY is true in production", async () => {
    process.env.TRUST_PROXY = "true";
    const warnSpy = vi.spyOn(appLogger, "warn");

    app = buildApp();
    await app.ready();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("SECURITY WARNING: TRUST_PROXY is set to true"),
    );
    warnSpy.mockRestore();
  });

  it("normalizes IPv6 /64 subnets correctly across compressed and expanded forms", () => {
    // 1. Compressed and fully-expanded forms of the same /64 map to the same key
    const compressed1 = normalizeClientSubnet("fd00::1");
    const compressed2 = normalizeClientSubnet("fd00::2");
    const fullyExpanded = normalizeClientSubnet(
      "fd00:0000:0000:0000:1234:5678:9abc:def0",
    );
    expect(compressed1).toBe("fd00:0000:0000:0000::/64");
    expect(compressed2).toBe("fd00:0000:0000:0000::/64");
    expect(fullyExpanded).toBe("fd00:0000:0000:0000::/64");
    expect(compressed1).toBe(compressed2);
    expect(compressed1).toBe(fullyExpanded);

    const prefix3HextetComp = normalizeClientSubnet("2001:db8:85a3::1");
    const prefix3HextetExp = normalizeClientSubnet(
      "2001:0db8:85a3:0000:0000:0000:0000:0001",
    );
    expect(prefix3HextetComp).toBe("2001:0db8:85a3:0000::/64");
    expect(prefix3HextetComp).toBe(prefix3HextetExp);

    // 2. Different /64s map to different keys
    const diffSubnet = normalizeClientSubnet("2001:db8:85a3:1::1");
    expect(diffSubnet).toBe("2001:0db8:85a3:0001::/64");
    expect(prefix3HextetComp).not.toBe(diffSubnet);

    const diffFd = normalizeClientSubnet("fd00:1::1");
    expect(diffFd).toBe("fd00:0001:0000:0000::/64");
    expect(compressed1).not.toBe(diffFd);

    // 3. IPv4-mapped IPv6 still maps to /24
    expect(normalizeClientSubnet("::ffff:192.0.2.1")).toBe("192.0.2.0/24");
    expect(normalizeClientSubnet("::ffff:198.51.100.99")).toBe(
      "198.51.100.0/24",
    );
    expect(normalizeClientSubnet("192.0.2.1")).toBe("192.0.2.0/24");
  });

  it("enforces progressive delay capped at 1000ms and does not hard-lock distributed attempts", async () => {
    const redis = getRedisClient();
    const testEmail = "test-progressive-cap@example.com";
    const testIp = "192.0.2.100";
    const globalKey = buildSystemCacheKey(
      "auth_throttle",
      `staff_login_global:${testEmail}`,
    );

    // Simulate 25 distributed failures on global key (exceeding 20)
    await redis.set(globalKey, "25");
    const check25 = await checkAccountThrottle("staff_login", testEmail, {
      clientIp: testIp,
    });
    expect(check25.allowed).toBe(true);
    // 25 - 20 + 1 = 6 multiplier -> 600ms
    expect(check25.progressiveDelayMs).toBe(600);

    // Simulate 40 distributed failures (delay capped at 1000ms: 100ms * min(n, 10))
    await redis.set(globalKey, "40");
    const check40 = await checkAccountThrottle("staff_login", testEmail, {
      clientIp: testIp,
    });
    expect(check40.allowed).toBe(true);
    expect(check40.retryAfterSeconds).toBe(0);
    expect(check40.progressiveDelayMs).toBe(1000);

    await redis.del(globalKey);
  });
});

