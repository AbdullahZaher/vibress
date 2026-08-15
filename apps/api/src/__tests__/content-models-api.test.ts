import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../main";
import { FastifyInstance } from "fastify";
import { getDb, users, userRoles, roles } from "@vibress/database";
import { eq } from "drizzle-orm";
import crypto from "node:crypto";
import { hashPassword } from "@vibress/security";

let ownerUserId: string;

async function ensureOwner(): Promise<void> {
  const db = getDb();
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.email, "owner@example.com"))
    .limit(1);

  if (rows.length > 0) {
    ownerUserId = rows[0]!.id;
  } else {
    const hash = await hashPassword("OwnerPass123!");
    ownerUserId = crypto.randomUUID();
    await db
      .insert(users)
      .values({
        id: ownerUserId,
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
          userId: ownerUserId,
          roleId: ownerRole[0].id,
        })
        .onConflictDoNothing();
    }
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

describe("Content Modeler API Routes", () => {
  let app: FastifyInstance;
  let cookieHeader: string;
  let modelSlug: string;
  let modelId: string;
  let entryId: string;

  beforeAll(async () => {
    await ensureOwner();
    app = buildApp();
    await app.ready();
    cookieHeader = await loginStaff(app);
  });

  afterAll(async () => {
    await app.close();
  });

  describe("Content Models Management", () => {
    it("POST /api/admin/v1/content-models creates a new custom content model", async () => {
      modelSlug = `books-${Date.now()}`;
      const res = await app.inject({
        method: "POST",
        url: "/api/admin/v1/content-models",
        headers: { cookie: cookieHeader },
        payload: {
          name: "Books Catalog",
          slug: modelSlug,
          description: "Curated library collection",
          fields: [
            { id: "f1", name: "Book Title", key: "title", type: "text", required: true },
            { id: "f2", name: "Pages", key: "pages", type: "number", required: true },
            { id: "f3", name: "Featured", key: "featured", type: "boolean" },
          ],
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.data.id).toBeDefined();
      expect(body.data.slug).toBe(modelSlug);
      modelId = body.data.id;
    });

    it("GET /api/admin/v1/content-models lists all models", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/admin/v1/content-models",
        headers: { cookie: cookieHeader },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data.some((m: { id: string }) => m.id === modelId)).toBe(true);
    });
  });

  describe("Custom Collection Entries Management", () => {
    it("POST /api/admin/v1/content-models/:slug/entries validates and creates entry", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/api/admin/v1/content-models/${modelSlug}/entries`,
        headers: { cookie: cookieHeader },
        payload: {
          title: "Clean Architecture",
          data: {
            title: "Clean Architecture",
            pages: 350,
            featured: true,
          },
          status: "published",
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.data.id).toBeDefined();
      expect(body.data.status).toBe("published");
      expect(body.data.data.pages).toBe(350);
      entryId = body.data.id;
    });

    it("POST /api/admin/v1/content-models/:slug/entries returns 400 for schema validation error", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/api/admin/v1/content-models/${modelSlug}/entries`,
        headers: { cookie: cookieHeader },
        payload: {
          title: "Invalid Book",
          data: {
            // missing required 'pages'
            featured: true,
          },
        },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.errors[0].code).toBe("VALIDATION_ERROR");
      expect(body.errors[0].fieldErrors?.pages).toBeDefined();
    });

    it("GET /api/admin/v1/content-models/:slug/entries lists collection entries", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/admin/v1/content-models/${modelSlug}/entries`,
        headers: { cookie: cookieHeader },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data.some((e: { id: string }) => e.id === entryId)).toBe(true);
    });

    it("GET /api/content/v1/collections/:slug returns published entries on public API", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/content/v1/collections/${modelSlug}`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data.length).toBeGreaterThanOrEqual(1);
      expect(body.data[0].title).toBe("Clean Architecture");
    });
  });
});
