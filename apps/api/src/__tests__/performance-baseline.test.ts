import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../main";
import { FastifyInstance } from "fastify";

interface LatencyStats {
  samples: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
}

function calculatePercentiles(latencies: number[]): LatencyStats {
  if (latencies.length === 0) return { samples: 0, p50Ms: 0, p95Ms: 0, p99Ms: 0 };
  const sorted = [...latencies].sort((a, b) => a - b);
  // Nearest-rank: ceil(p * n) - 1. For 20 requests p95 is the
  // 19th observation, not the maximum (which belongs to p99).
  const percentile = (p: number): number => {
    const index = Math.max(0, Math.ceil(p * sorted.length) - 1);
    return Number((sorted[index] ?? 0).toFixed(2));
  };
  return {
    samples: sorted.length,
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    p99Ms: percentile(0.99),
  };
}

import { getDb, users, userRoles, roles, eq, publicationMemberships } from "@vibress/database";
import { hashPassword } from "@vibress/security";
import crypto from "node:crypto";

async function ensureOwner(): Promise<void> {
  const db = getDb();
  let ownerId: string;
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.email, "owner@example.com"))
    .limit(1);
  if (rows.length === 0) {
    const hash = await hashPassword("OwnerPass123!");
    ownerId = crypto.randomUUID();
    await db
      .insert(users)
      .values({
        id: ownerId,
        email: "owner@example.com",
        name: "Owner",
        slug: "perf-owner",
        passwordHash: hash,
        status: "active",
      })
      .onConflictDoNothing();
    const ownerRole = await db
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.key, "owner"))
      .limit(1);
    if (ownerRole[0]) {
      await db
        .insert(userRoles)
        .values({ userId: ownerId, roleId: ownerRole[0].id })
        .onConflictDoNothing();
    }
  } else {
    ownerId = rows[0]!.id;
  }

  await db
    .insert(publicationMemberships)
    .values({
      id: crypto.randomUUID(),
      publicationId: "pub_default",
      userId: ownerId,
      role: "owner",
    })
    .onConflictDoNothing();
}

describe("Latency percentile calculation", () => {
  it("uses the nearest rank, including when p95 falls below the maximum", () => {
    const latencies = [...Array.from({ length: 19 }, (_, index) => index + 1), 450];
    expect(calculatePercentiles(latencies)).toEqual({
      samples: 20,
      p50Ms: 10,
      p95Ms: 19,
      p99Ms: 450,
    });
    expect(calculatePercentiles([12.345])).toEqual({
      samples: 1,
      p50Ms: 12.35,
      p95Ms: 12.35,
      p99Ms: 12.35,
    });
  });
});

describe("PHASE 11: Production Performance Baseline Suite (p50/p95/p99)", () => {
  let app: FastifyInstance;
  let staffCookie: string;
  let authorId: string;

  beforeAll(async () => {
    app = buildApp();
    await app.ready();
    await ensureOwner();

    // Authenticate
    const loginRes = await app.inject({
      method: "POST",
      url: "/api/admin/v1/auth/login",
      payload: { email: "owner@example.com", password: "OwnerPass123!" },
    });
    const setCookie = loginRes.headers["set-cookie"];
    staffCookie = Array.isArray(setCookie) ? setCookie[0]! : (setCookie as string);

    const meRes = await app.inject({
      method: "GET",
      url: "/api/admin/v1/auth/me",
      headers: { cookie: staffCookie },
    });
    authorId = JSON.parse(meRes.body).user.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it("measures Public Content Read latency baseline (p50/p95/p99)", async () => {
    const latencies: number[] = [];
    for (let i = 0; i < 50; i++) {
      const start = performance.now();
      const res = await app.inject({
        method: "GET",
        url: "/api/content/v1/posts",
      });
      latencies.push(performance.now() - start);
      expect(res.statusCode).toBe(200);
    }
    const stats = calculatePercentiles(latencies);
    expect(stats.p95Ms).toBeLessThan(150);
  });

  it("measures Search Querying latency baseline (p50/p95/p99)", async () => {
    const latencies: number[] = [];
    for (let i = 0; i < 50; i++) {
      const start = performance.now();
      const res = await app.inject({
        method: "GET",
        url: "/api/content/v1/search?q=Vibress",
      });
      latencies.push(performance.now() - start);
      expect([200, 404]).toContain(res.statusCode);
    }
    const stats = calculatePercentiles(latencies);
    expect(stats.p95Ms).toBeLessThan(150);
  });

  it("measures Post Mutation & Publishing latency baseline (p50/p95/p99)", async () => {
    const latencies: number[] = [];
    for (let i = 0; i < 20; i++) {
      const start = performance.now();
      const createRes = await app.inject({
        method: "POST",
        url: "/api/admin/v1/posts",
        headers: { cookie: staffCookie, origin: "http://localhost:7777" },
        payload: {
          title: `Perf Post ${i} ${Date.now()}`,
          slug: `perf-post-${i}-${Date.now()}`,
          primaryAuthorId: authorId,
        },
      });
      latencies.push(performance.now() - start);
      expect([200, 201]).toContain(createRes.statusCode);
    }
    const stats = calculatePercentiles(latencies);
    expect(stats.p95Ms).toBeLessThan(200);
  });
});
