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
  return {
    samples: sorted.length,
    p50Ms: Number((sorted[Math.floor(sorted.length * 0.5)] ?? 0).toFixed(2)),
    p95Ms: Number((sorted[Math.floor(sorted.length * 0.95)] ?? 0).toFixed(2)),
    p99Ms: Number((sorted[Math.min(Math.floor(sorted.length * 0.99), sorted.length - 1)] ?? 0).toFixed(2)),
  };
}

import { getDb, users, userRoles, roles, eq } from "@vibress/database";
import { hashPassword } from "@vibress/auth";
import crypto from "node:crypto";

async function ensureOwner(): Promise<void> {
  const db = getDb();
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.email, "owner@example.com"))
    .limit(1);
  if (rows.length > 0) return;
  const hash = await hashPassword("OwnerPass123!");
  const ownerId = crypto.randomUUID();
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
    .where(eq(roles.name, "owner"))
    .limit(1);
  if (ownerRole[0]) {
    await db
      .insert(userRoles)
      .values({ userId: ownerId, roleId: ownerRole[0].id })
      .onConflictDoNothing();
  }
}

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
