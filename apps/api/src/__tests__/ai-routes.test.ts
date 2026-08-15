import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../main";
import { FastifyInstance } from "fastify";
import { getDb } from "@vibress/database";
import { eq } from "drizzle-orm";
import crypto from "node:crypto";
import { hashPassword } from "@vibress/security";

async function ensureOwner(): Promise<void> {
  const db = getDb();
  const { users, userRoles, roles } = await import("@vibress/database");
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
      slug: "e2e-owner",
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
      .values({
        userId: ownerId,
        roleId: ownerRole[0].id,
      })
      .onConflictDoNothing();
  }
}

async function loginStaff(app: FastifyInstance): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/admin/v1/auth/login",
    payload: { email: "owner@example.com", password: "OwnerPass123!" },
  });
  expect(res.statusCode).toBe(200);
  const setCookie = (res.headers["set-cookie"] as unknown as string) || "";
  return setCookie.split(";")[0] ?? "";
}

describe("AI Gateway API Routes", () => {
  let app: FastifyInstance;
  let cookieHeader: string;

  beforeAll(async () => {
    await ensureOwner();
    app = buildApp();
    await app.ready();
    cookieHeader = await loginStaff(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it("rejects unauthorized access without staff session", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/admin/v1/ai/status",
    });

    expect(res.statusCode).toBe(401);
  });

  it("GET /api/admin/v1/ai/status returns configuration and provider list", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/admin/v1/ai/status",
      headers: { cookie: cookieHeader },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toBeDefined();
    expect(typeof body.data.enabled).toBe("boolean");
    expect(Array.isArray(body.data.providers)).toBe(true);
  });

  it("POST /api/admin/v1/ai/generate requires prompt or context", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/admin/v1/ai/generate",
      headers: { cookie: cookieHeader },
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.errors[0].code).toBe("VALIDATION_ERROR");
  });

  it("GET /api/admin/v1/ai/metrics returns aggregated execution statistics", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/admin/v1/ai/metrics",
      headers: { cookie: cookieHeader },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toBeDefined();
    expect(typeof body.data.totalRequests).toBe("number");
  });
});
