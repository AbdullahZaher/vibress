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
    it("lists the publication's enabled content languages", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/admin/v1/content-models/locales",
        headers: { cookie: cookieHeader },
      });
      expect(res.statusCode).toBe(200);
      expect(typeof res.json().data.defaultLocale).toBe("string");
      expect(res.json().data.enabledLocales).toContain(res.json().data.defaultLocale);
    });

    it("supports Arabic model slugs without changing existing ASCII slugs", async () => {
      const slug = `مشاريع-${crypto.randomUUID().slice(0, 8)}`;
      const create = await app.inject({
        method: "POST",
        url: "/api/admin/v1/content-models",
        headers: { cookie: cookieHeader, origin: "http://localhost:7777" },
        payload: { name: "مشاريع عربية", slug, fields: [] },
      });
      expect(create.statusCode).toBe(201);
      expect(create.json().data.slug).toBe(slug);
      const id = create.json().data.id as string;
      const read = await app.inject({
        method: "GET",
        url: `/api/admin/v1/content-models/${id}`,
        headers: { cookie: cookieHeader },
      });
      expect(read.statusCode).toBe(200);
      expect(read.json().data.slug).toBe(slug);
      const remove = await app.inject({
        method: "DELETE",
        url: `/api/admin/v1/content-models/${id}`,
        headers: { cookie: cookieHeader, origin: "http://localhost:7777" },
      });
      expect(remove.statusCode).toBe(200);
    });

    it("POST /api/admin/v1/content-models creates a new custom content model", async () => {
      modelSlug = `books-${Date.now()}`;
      const res = await app.inject({
        method: "POST",
        url: "/api/admin/v1/content-models",
        headers: { cookie: cookieHeader, origin: "http://localhost:7777" },
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
        headers: { cookie: cookieHeader, origin: "http://localhost:7777" },
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
        headers: { cookie: cookieHeader, origin: "http://localhost:7777" },
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
        headers: { cookie: cookieHeader, origin: "http://localhost:7777" },
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
        headers: { cookie: cookieHeader, origin: "http://localhost:7777" },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data.some((e: { id: string }) => e.id === entryId)).toBe(true);
    });

    it("supports searchable, paginated relation choices without changing selected data", async () => {
      const found = await app.inject({
        method: "GET",
        url: `/api/admin/v1/content-models/${modelSlug}/entries?limit=1&offset=0&search=Clean&sortBy=title&sortOrder=asc`,
        headers: { cookie: cookieHeader },
      });
      expect(found.statusCode).toBe(200);
      expect(found.json().data).toHaveLength(1);
      expect(found.json().data[0].id).toBe(entryId);

      const next = await app.inject({
        method: "GET",
        url: `/api/admin/v1/content-models/${modelSlug}/entries?limit=1&offset=1&search=Clean&sortBy=title&sortOrder=asc`,
        headers: { cookie: cookieHeader },
      });
      expect(next.statusCode).toBe(200);
      expect(next.json().data).toEqual([]);

      const missing = await app.inject({
        method: "GET",
        url: `/api/admin/v1/content-models/${modelSlug}/entries?search=not-a-real-entry-title-xyz`,
        headers: { cookie: cookieHeader },
      });
      expect(missing.statusCode).toBe(200);
      expect(missing.json().data).toEqual([]);
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
  it("rejects unsafe schema evolution when entries exist", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/admin/v1/content-models/${modelId}`,
      headers: { cookie: cookieHeader, origin: "http://localhost:7777" },
      payload: {
        fields: [
          { id: "f1", name: "Book Title", key: "title", type: "number", required: true },
          { id: "f2", name: "Pages", key: "pages", type: "number", required: true },
          { id: "f3", name: "Featured", key: "featured", type: "boolean" },
        ],
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().errors[0].code).toBe("VALIDATION_ERROR");
    const modelRes = await app.inject({
      method: "GET",
      url: `/api/admin/v1/content-models/${modelId}`,
      headers: { cookie: cookieHeader, origin: "http://localhost:7777" },
    });
    expect(modelRes.json().data.fields[0].type).toBe("text");
  });

  it("rejects invalid preview field definitions rather than returning a misleading safe diff", async () => {
    const url = `/api/admin/v1/content-models/${modelId}/schema-evolution-preview`;
    const headers = { cookie: cookieHeader, origin: "http://localhost:7777" };
    for (const fields of [
      [
        { id: "a", name: "One", key: "duplicate", type: "text" },
        { id: "b", name: "Two", key: "duplicate", type: "text" },
      ],
      [{ id: "reserved", name: "Prototype", key: "__proto__", type: "text" }],
    ]) {
      const res = await app.inject({ method: "POST", url, headers, payload: { fields } });
      expect(res.statusCode).toBe(400);
      expect(res.json().errors[0].code).toBe("VALIDATION_ERROR");
    }
  });

  it("previews and blocks tightened legacy validation constraints without modifying existing data", async () => {
    const slug = `legacy-schema-${crypto.randomUUID().slice(0, 8)}`;
    const fields = [
      { id: "score", name: "Score", key: "score", type: "number", validation: { min: 1 } },
    ];
    const headers = { cookie: cookieHeader, origin: "http://localhost:7777" };
    const create = await app.inject({
      method: "POST", url: "/api/admin/v1/content-models",
      headers, payload: { name: "Legacy validation", slug, fields },
    });
    expect(create.statusCode).toBe(201);
    const id = create.json().data.id as string;
    const entry = await app.inject({
      method: "POST", url: `/api/admin/v1/content-models/${slug}/entries`,
      headers, payload: { title: "Recorded score", data: { score: 3 } },
    });
    expect(entry.statusCode).toBe(201);

    const tightened = [
      { ...fields[0]!, validation: { min: 5 } },
    ];
    const preview = await app.inject({
      method: "POST", url: `/api/admin/v1/content-models/${id}/schema-evolution-preview`,
      headers, payload: { fields: tightened },
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().data.safe).toBe(false);

    const update = await app.inject({
      method: "PATCH", url: `/api/admin/v1/content-models/${id}`,
      headers, payload: { fields: tightened },
    });
    expect(update.statusCode).toBe(400);
    expect(update.json().errors[0].code).toBe("VALIDATION_ERROR");
    const read = await app.inject({
      method: "GET", url: `/api/admin/v1/content-models/${id}`, headers,
    });
    expect(read.statusCode).toBe(200);
    expect(read.json().data.fields[0].validation.min).toBe(1);
    const persistedEntry = await app.inject({
      method: "GET", url: `/api/admin/v1/content-models/${slug}/entries/${entry.json().data.id}`,
      headers,
    });
    expect(persistedEntry.statusCode).toBe(200);
    expect(persistedEntry.json().data.data.score).toBe(3);
  });

  it("cannot delete models containing entries", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/api/admin/v1/content-models/${modelId}`,
      headers: { cookie: cookieHeader, origin: "http://localhost:7777" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().errors[0].code).toBe("MODEL_IN_USE");
    const entryRes = await app.inject({
      method: "GET",
      url: `/api/admin/v1/content-models/${modelSlug}/entries/${entryId}`,
      headers: { cookie: cookieHeader, origin: "http://localhost:7777" },
    });
    expect(entryRes.statusCode).toBe(200);
  });

  it("rejects malformed entry filters and invalid lifecycle values at runtime", async () => {
    const malformed = await app.inject({
      method: "GET",
      url: `/api/admin/v1/content-models/${modelSlug}/entries?limit=nan`,
      headers: { cookie: cookieHeader },
    });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json().errors[0].code).toBe("VALIDATION_ERROR");

    const state = await app.inject({
      method: "PATCH",
      url: `/api/admin/v1/content-models/${modelSlug}/entries/${entryId}`,
      headers: { cookie: cookieHeader, origin: "http://localhost:7777" },
      payload: { status: "invalid" },
    });
    expect(state.statusCode).toBe(400);
    expect(state.json().errors[0].code).toBe("VALIDATION_ERROR");
  });

});
