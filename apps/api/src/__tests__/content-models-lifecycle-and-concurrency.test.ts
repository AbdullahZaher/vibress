import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../main";
import { FastifyInstance } from "fastify";
import {
  getDb,
  users,
  roles,
  userRoles,
  contentModels,
} from "@vibress/database";
import { eq } from "drizzle-orm";
import crypto from "node:crypto";
import { hashPassword } from "@vibress/security";

async function ensureUser(email: string, roleKey: string, pass: string): Promise<string> {
  const db = getDb();
  let userRow = await db.select().from(users).where(eq(users.email, email)).limit(1);
  const hash = await hashPassword(pass);
  let userId: string;
  if (userRow.length === 0) {
    userId = crypto.randomUUID();
    await db.insert(users).values({
      id: userId,
      email,
      name: email,
      slug: email.split("@")[0] + "-test-" + crypto.randomUUID().slice(0, 6),
      passwordHash: hash,
      status: "active",
    });
  } else {
    userId = userRow[0]!.id;
    await db.update(users).set({ passwordHash: hash, status: "active" }).where(eq(users.id, userId));
  }

  const roleRows = await db.select().from(roles).where(eq(roles.key, roleKey)).limit(1);
  if (roleRows[0]) {
    await db.insert(userRoles).values({ userId, roleId: roleRows[0].id }).onConflictDoNothing();
  }
  return userId;
}

async function loginUser(app: FastifyInstance, email: string, pass: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/admin/v1/auth/login",
    payload: { email, password: pass },
  });
  expect(res.statusCode).toBe(200);
  const setCookie = (res.headers["set-cookie"] as unknown as string) || "";
  return setCookie.split(";")[0] ?? "";
}

describe("Content Modeler — Publication Lifecycle & Concurrency Hardening (P0/P1)", () => {
  let app: FastifyInstance;

  let editorCookie: string;
  let publisherCookie: string;

  const testModelSlug = "lifecycle-hardening-model";
  let testEntryId: string;

  beforeAll(async () => {
    app = buildApp();
    await app.ready();
    const db = getDb();

    // Ensure Publisher (owner) and Editor (author role with posts.edit, but lacking posts.publish)
    await ensureUser("publisher@example.com", "owner", "PublisherPass123!");
    await ensureUser("editor-only@example.com", "author", "EditorPass123!");

    publisherCookie = await loginUser(app, "publisher@example.com", "PublisherPass123!");
    editorCookie = await loginUser(app, "editor-only@example.com", "EditorPass123!");

    // Clean up any existing test models
    await db
      .delete(contentModels)
      .where(eq(contentModels.slug, testModelSlug));

    const targetModelSlug = "related-author-model";
    await db
      .delete(contentModels)
      .where(eq(contentModels.slug, targetModelSlug));

    // 4. Create content models
    const authorModelRes = await app.inject({
      method: "POST",
      url: "/api/admin/v1/content-models",
      headers: { cookie: publisherCookie, origin: "http://localhost:7777" },
      payload: {
        name: "Related Author",
        slug: targetModelSlug,
        fields: [
          { id: "f1", name: "Name", key: "name", type: "short_text", apiVisibility: "public" },
          { id: "f2", name: "Secret Phone", key: "secretPhone", type: "short_text", apiVisibility: "private" },
          { id: "f3", name: "Member Bio", key: "memberBio", type: "text", apiVisibility: "authenticated" },
        ],
      },
    });
    expect(authorModelRes.statusCode).toBe(201);

    const modelRes = await app.inject({
      method: "POST",
      url: "/api/admin/v1/content-models",
      headers: { cookie: publisherCookie, origin: "http://localhost:7777" },
      payload: {
        name: "Lifecycle Test Model",
        slug: testModelSlug,
        fields: [
          { id: "f_title", name: "Title", key: "title", type: "short_text", apiVisibility: "public" },
          { id: "f_author", name: "Author", key: "author", type: "relation", relationModel: targetModelSlug, apiVisibility: "public" },
        ],
      },
    });
    expect(modelRes.statusCode).toBe(201);
  });

  afterAll(async () => {
    await app.close();
  });

  describe("Publication Lifecycle Authorization Gates", () => {
    it("allows editor-only staff to create draft entries", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/api/admin/v1/content-models/${testModelSlug}/entries`,
        headers: { cookie: editorCookie, origin: "http://localhost:7777" },
        payload: {
          title: "Initial Draft Post",
          data: { title: "Draft Content" },
          status: "draft",
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.data.status).toBe("draft");
      expect(body.data.version).toBe(1);
      testEntryId = body.data.id;
    });

    it("blocks editor-only staff from directly creating published entries", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/api/admin/v1/content-models/${testModelSlug}/entries`,
        headers: { cookie: editorCookie, origin: "http://localhost:7777" },
        payload: {
          title: "Direct Published Attempt",
          data: { title: "Bypassing drafts" },
          status: "published",
        },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().errors[0].code).toBe("PERMISSION_DENIED");
    });

    it("blocks editor-only staff from transitioning draft to published via PUT/PATCH", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: `/api/admin/v1/content-models/${testModelSlug}/entries/${testEntryId}`,
        headers: { cookie: editorCookie, origin: "http://localhost:7777" },
        payload: {
          status: "published",
        },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().errors[0].code).toBe("PERMISSION_DENIED");
    });

    it("allows publisher staff to publish the draft entry", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/api/admin/v1/content-models/${testModelSlug}/entries/${testEntryId}/publish`,
        headers: { cookie: publisherCookie, origin: "http://localhost:7777" },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().data.status).toBe("published");
    });

    it("blocks editor-only staff from modifying published entry content via PUT/PATCH", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: `/api/admin/v1/content-models/${testModelSlug}/entries/${testEntryId}`,
        headers: { cookie: editorCookie, origin: "http://localhost:7777" },
        payload: {
          title: "Malicious Edit to Published Post",
        },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().errors[0].code).toBe("PERMISSION_DENIED");
      expect(res.json().errors[0].message).toContain("posts.publish required");
    });

    it("blocks editor-only staff from unpublishing a published entry via PUT/PATCH", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: `/api/admin/v1/content-models/${testModelSlug}/entries/${testEntryId}`,
        headers: { cookie: editorCookie, origin: "http://localhost:7777" },
        payload: {
          status: "draft",
        },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().errors[0].code).toBe("PERMISSION_DENIED");
    });

    it("blocks editor-only staff from deleting a published entry", async () => {
      const res = await app.inject({
        method: "DELETE",
        url: `/api/admin/v1/content-models/${testModelSlug}/entries/${testEntryId}`,
        headers: { cookie: editorCookie, origin: "http://localhost:7777" },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().errors[0].code).toBe("PERMISSION_DENIED");
      expect(res.json().errors[0].message).toContain("posts.publish required to delete published content");
    });
  });

  describe("Optimistic Concurrency Control (P1)", () => {
    it("updates successfully when expectedVersion matches database version", async () => {
      const getRes = await app.inject({
        method: "GET",
        url: `/api/admin/v1/content-models/${testModelSlug}/entries/${testEntryId}`,
        headers: { cookie: publisherCookie },
      });
      const currentVersion = getRes.json().data.version;

      const updateRes = await app.inject({
        method: "PATCH",
        url: `/api/admin/v1/content-models/${testModelSlug}/entries/${testEntryId}`,
        headers: { cookie: publisherCookie, origin: "http://localhost:7777" },
        payload: {
          title: "Authorized Publisher Update",
          expectedVersion: currentVersion,
        },
      });

      expect(updateRes.statusCode).toBe(200);
      expect(updateRes.json().data.version).toBe(currentVersion + 1);
    });

    it("rejects write with 409 CONCURRENCY_CONFLICT when expectedVersion is stale", async () => {
      const staleVersion = 1; // It has already been incremented above

      const updateRes = await app.inject({
        method: "PATCH",
        url: `/api/admin/v1/content-models/${testModelSlug}/entries/${testEntryId}`,
        headers: { cookie: publisherCookie, origin: "http://localhost:7777" },
        payload: {
          title: "Stale Overwrite Attempt",
          expectedVersion: staleVersion,
        },
      });

      expect(updateRes.statusCode).toBe(409);
      const body = updateRes.json();
      expect(body.errors[0].code).toBe("CONCURRENCY_CONFLICT");
      expect(body.errors[0].expectedVersion).toBe(staleVersion);
      expect(body.errors[0].currentVersion).toBeGreaterThan(staleVersion);
    });
  });

  describe("Public Recursive Relation Visibility Filtering (P0)", () => {
    let authorId: string;

    beforeAll(async () => {
      // Create author with private phone and authenticated bio
      const authorRes = await app.inject({
        method: "POST",
        url: "/api/admin/v1/content-models/related-author-model/entries",
        headers: { cookie: publisherCookie, origin: "http://localhost:7777" },
        payload: {
          title: "Dr. Jane Doe",
          slug: "dr-jane-doe",
          data: {
            name: "Dr. Jane Doe",
            secretPhone: "+1-555-0199",
            memberBio: "Exclusive member biography",
          },
          status: "published",
        },
      });
      expect(authorRes.statusCode).toBe(201);
      authorId = authorRes.json().data.id;

      // Create article referencing author
      const articleRes = await app.inject({
        method: "POST",
        url: `/api/admin/v1/content-models/${testModelSlug}/entries`,
        headers: { cookie: publisherCookie, origin: "http://localhost:7777" },
        payload: {
          title: "Public Article with Expanded Relation",
          slug: "public-article-relation",
          data: {
            title: "Public Article with Expanded Relation",
            author: authorId,
          },
          status: "published",
        },
      });
      expect(articleRes.statusCode).toBe(201);
    });

    it("recursively scrubs private and authenticated fields from expanded relation in public API", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/content/v1/collections/${testModelSlug}/public-article-relation?includeRelations=true`,
      });

      expect(res.statusCode).toBe(200);
      const entry = res.json().data;
      expect(entry.data.author).toBeDefined();

      const relAuthor = entry.data.author;
      expect(relAuthor.title).toBe("Dr. Jane Doe");
      // Public name must be present
      expect(relAuthor.data.name).toBe("Dr. Jane Doe");
      // Private secretPhone MUST BE STRIPPED
      expect(relAuthor.data.secretPhone).toBeUndefined();
      // Authenticated memberBio MUST BE STRIPPED for anonymous public
      expect(relAuthor.data.memberBio).toBeUndefined();
      // Internal metadata pipeline _fields MUST NOT leak
      expect(relAuthor._fields).toBeUndefined();
    });
  });
});
