import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../main";
import { FastifyInstance } from "fastify";
import { getDb } from "@vibress/database";
import { eq } from "drizzle-orm";
import crypto from "node:crypto";
import { hashPassword } from "@vibress/security";

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
  if (ownerRole[0])
    await db
      .insert(userRoles)
      .values({ userId: ownerId, roleId: ownerRole[0].id });
}

async function seedIndexedPost(): Promise<string> {
  const db = getDb();
  const { users, searchDocuments } = await import("@vibress/database");
  const ownerRows = await db
    .select()
    .from(users)
    .where(eq(users.email, "owner@example.com"))
    .limit(1);
  const ownerId = ownerRows[0]?.id || "unknown";
  const { posts } = await import("@vibress/database");
  const existing = await db
    .select()
    .from(posts)
    .where(eq(posts.slug, "intelligence-search-post"))
    .limit(1);
  const postId = existing[0]?.id || crypto.randomUUID();
  if (!existing[0]) {
    await db
      .insert(posts)
      .values({
        id: postId,
        title: "Intelligence Search Post",
        slug: "intelligence-search-post",
        content: {
          schema: "vibress-studio",
          version: 1,
          root: { type: "root", children: [] },
        },
        status: "published",
        visibility: "public",
        primaryAuthorId: ownerId,
        createdBy: ownerId,
        updatedBy: ownerId,
      })
      .onConflictDoNothing();
  }
  // Index directly (as the worker would); retried on every run so a
  // previous interrupted run cannot leave the post unindexed.
  await db
    .insert(searchDocuments)
    .values({
      id: `sd-${postId}`,
      entityType: "post",
      entityId: postId,
      title: "Intelligence Search Post",
      bodyText: "This post covers intelligence and discovery topics.",
      slug: "intelligence-search-post",
      url: "/posts/intelligence-search-post",
      searchable: true,
      updatedAt: new Date(),
    })
    .onConflictDoNothing();
  return postId;
}

async function seedRestrictedPost(): Promise<string> {
  const db = getDb();
  const { users } = await import("@vibress/database");
  const ownerRows = await db
    .select()
    .from(users)
    .where(eq(users.email, "owner@example.com"))
    .limit(1);
  const ownerId = ownerRows[0]?.id || "unknown";
  const { posts } = await import("@vibress/database");
  const [row] = await db
    .insert(posts)
    .values({
      id: crypto.randomUUID(),
      title: "Members Only Secret Content",
      slug: `members-only-${Date.now()}`,
      content: {
        schema: "vibress-studio",
        version: 1,
        root: { type: "root", children: [] },
      },
      status: "published",
      visibility: "members",
      primaryAuthorId: ownerId,
      createdBy: ownerId,
      updatedBy: ownerId,
    })
    .returning();
  return row!.id;
}

describe("Batch 13 — Intelligence Integration & Security", () => {
  let app: FastifyInstance;
  let staffCookie: string;

  beforeAll(async () => {
    app = buildApp();
    await app.ready();
    await ensureOwner();
    staffCookie = await loginStaff(app);
  });

  afterAll(async () => {
    await app.close();
  });

  // ---------------- Search ----------------
  it("public search finds indexed published content", async () => {
    const postId = await seedIndexedPost();
    const res = await app.inject({
      method: "GET",
      url: "/api/content/v1/search?q=Intelligence",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.results.length).toBeGreaterThan(0);
    const found = body.results.find((r: any) => r.entityId === postId);
    expect(found).toBeTruthy();
    expect(found.title).toContain("Intelligence");
  });

  it("restricted content (members visibility) is never searchable", async () => {
    await seedRestrictedPost();
    const res = await app.inject({
      method: "GET",
      url: "/api/content/v1/search?q=Members+Only+Secret",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Restricted content is not indexed, so it cannot appear
    expect(
      body.results.some((r: any) => r.title.includes("Members Only Secret")),
    ).toBe(false);
  });

  it("search rejects an over-long query (DoS protection)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/content/v1/search?q=${"a".repeat(200)}`,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().errors[0].code).toBe("QUERY_TOO_LONG");
  });

  it("search rejects wildcard-only queries", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/content/v1/search?q=***",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().errors[0].code).toBe("INVALID_QUERY");
  });

  it("search is rate limited (200/min in test)", async () => {
    // Fire 210 requests from a pinned IP — should hit the limit
    let limited = false;
    for (let i = 0; i < 210; i++) {
      const res = await app.inject({
        method: "GET",
        url: "/api/content/v1/search?q=test",
        remoteAddress: "203.0.113.7",
      });
      if (res.statusCode === 429) {
        limited = true;
        break;
      }
    }
    expect(limited).toBe(true);
  });

  // ---------------- Analytics ----------------
  it("admin can read analytics metrics (analytics.read)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/admin/v1/analytics/metrics?from=2026-01-01&to=2026-12-31",
      headers: { cookie: staffCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.timezone).toBe("UTC");
    expect(Array.isArray(body.metrics)).toBe(true);
  });

  it("analytics metrics require staff auth (401)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/admin/v1/analytics/metrics",
    });
    expect(res.statusCode).toBe(401);
  });

  // ---------------- Search admin ----------------
  it("search rebuild requires search.manage (owner has it)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/admin/v1/search/rebuild",
      headers: { cookie: staffCookie, origin: "http://localhost:7777" },
    });
    expect(res.statusCode).toBe(202);
  });

  it("search index count endpoint works", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/admin/v1/search/index-count",
      headers: { cookie: staffCookie },
    });
    expect(res.statusCode).toBe(200);
    expect(typeof res.json().count).toBe("number");
  });

  // ---------------- Automations ----------------
  it("admin creates an automation", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/admin/v1/automations",
      headers: { cookie: staffCookie, origin: "http://localhost:7777" },
      payload: {
        key: `intel-auto-${Date.now()}`,
        name: "Welcome Webhook",
        triggerEvent: "member.created",
        conditions: [{ field: "status", op: "equals", value: "active" }],
        actions: [
          {
            type: "webhook",
            config: {
              url: "https://receiver.example.com/hook",
              eventType: "member.welcome",
            },
          },
        ],
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().automation.status).toBe("draft");
    expect(res.json().automation.version).toBe(1);
  });

  it("admin cannot create an automation with an invalid trigger", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/admin/v1/automations",
      headers: { cookie: staffCookie, origin: "http://localhost:7777" },
      payload: {
        key: "bad",
        name: "Bad",
        triggerEvent: "pwn.all",
        actions: [],
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().errors[0].code).toBe("INVALID_TRIGGER");
  });

  it("admin activates the automation", async () => {
    const listRes = await app.inject({
      method: "GET",
      url: "/api/admin/v1/automations",
      headers: { cookie: staffCookie },
    });
    const automation =
      listRes.json().automations[listRes.json().automations.length - 1];
    const res = await app.inject({
      method: "POST",
      url: `/api/admin/v1/automations/${automation.id}/activate`,
      headers: { cookie: staffCookie, origin: "http://localhost:7777" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().automation.status).toBe("active");
  });

  it("manual run works for an active automation", async () => {
    const listRes = await app.inject({
      method: "GET",
      url: "/api/admin/v1/automations",
      headers: { cookie: staffCookie },
    });
    const automation =
      listRes.json().automations[listRes.json().automations.length - 1];
    const res = await app.inject({
      method: "POST",
      url: `/api/admin/v1/automations/${automation.id}/run`,
      headers: { cookie: staffCookie, origin: "http://localhost:7777" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().run.triggerEvent).toBe("manual");
  });

  it("automation run history is inspectable", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/admin/v1/automation-runs",
      headers: { cookie: staffCookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().runs.length).toBeGreaterThan(0);
  });

  it("automation routes require RBAC (401 unauth)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/admin/v1/automations",
    });
    expect(res.statusCode).toBe(401);
  });

  it("automation runs list requires staff auth", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/admin/v1/automation-runs",
    });
    expect(res.statusCode).toBe(401);
  });

  it("CSRF: automation creation without origin is rejected", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/admin/v1/automations",
      headers: { cookie: staffCookie },
      payload: {
        key: "no-origin",
        name: "X",
        triggerEvent: "member.created",
        actions: [],
      },
    });
    expect(res.statusCode).toBe(403);
  });
});
