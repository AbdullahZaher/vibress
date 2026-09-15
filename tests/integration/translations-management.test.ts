import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../../apps/api/src/main";
import { getDb, posts, contentTranslations, users, settings, roles, userRoles, eq, and } from "@vibress/database";
import { hashPassword } from "@vibress/security";
import { DrizzleUserRepository, UsersService } from "@vibress/users";
import { randomUUID } from "crypto";

async function ensureUserWithRole(email: string, roleName: string, passwordPlain: string): Promise<string> {
  const db = getDb();
  const userRepo = new DrizzleUserRepository();
  const usersService = new UsersService(userRepo);
  const hash = await hashPassword(passwordPlain);

  let user = await usersService.findByEmail(email);
  if (!user) {
    user = await usersService.createUser({
      email,
      name: `Test ${roleName}`,
      passwordHash: hash,
      status: "active",
    });
  } else {
    await db.update(users).set({ passwordHash: hash }).where(eq(users.id, user.id));
  }

  const [role] = await db.select().from(roles).where(eq(roles.name, roleName));
  if (role) {
    const existing = await db
      .select()
      .from(userRoles)
      .where(and(eq(userRoles.userId, user.id), eq(userRoles.roleId, role.id)));
    if (!existing[0]) {
      await db.insert(userRoles).values({
        userId: user.id,
        roleId: role.id,
      });
    }
  }
  return user.id;
}

describe("Translation Management & Editorial UX API Integration Suite", () => {
  let app: ReturnType<typeof buildApp>;
  let ownerCookie = "";
  let ownerId = "";
  let createdTrId = "";
  const db = getDb();

  const testPostId = randomUUID();
  const runSuffix = randomUUID().slice(0, 8);
  const postSlug = `integration-post-${runSuffix}`;
  const arabicSlug = `al-manshur-${runSuffix}`;

  beforeAll(async () => {
    app = buildApp();
    await app.ready();

    // Ensure site.locale is 'en' for this test suite
    await db
      .delete(settings)
      .where(and(eq(settings.namespace, "site"), eq(settings.key, "locale")));

    // Ensure test owner exists
    await ensureUserWithRole("owner@example.com", "owner", "OwnerPass123!");

    // Login as default seeded owner
    const loginRes = await app.inject({
      method: "POST",
      url: "/api/admin/v1/auth/login",
      payload: { email: "owner@example.com", password: "OwnerPass123!" },
    });

    expect(loginRes.statusCode).toBe(200);
    const setCookie = (loginRes.headers["set-cookie"] as unknown as string) || "";
    ownerCookie = setCookie.split(";")[0] ?? "";
    ownerId = loginRes.json().user.id;

    // Create a published test post
    const now = new Date();
    await db.insert(posts).values({
      id: testPostId,
      publicationId: "pub_default",
      title: `Integration Source Post ${runSuffix}`,
      slug: postSlug,
      excerpt: "English source excerpt for translation testing",
      content: { schema: "vibress-studio", version: 1, root: { type: "root", children: [] } },
      status: "published",
      visibility: "public",
      primaryAuthorId: ownerId,
      createdBy: ownerId,
      updatedBy: ownerId,
      publishedAt: now,
      createdAt: now,
      updatedAt: now,
    });
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  describe("GET /api/admin/v1/translations/matrix", () => {
    it("returns paginated translation matrix containing enabled publication locales", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/admin/v1/translations/matrix?search=${runSuffix}&limit=10`,
        headers: { cookie: ownerCookie },
      });

      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data.items).toBeDefined();
      expect(Array.isArray(data.items)).toBe(true);
      expect(data.total).toBeGreaterThan(0);
      expect(data.enabledLocales).toContain("en");
      expect(data.enabledLocales).toContain("ar-SA");

      const item = data.items.find((i: any) => i.id === testPostId);
      expect(item).toBeDefined();
      expect(item.locales["en"]?.status).toBe("published");
      expect(item.locales["ar-SA"]?.status).toBe("untranslated");
    });
  });

  describe("GET /api/admin/v1/translations/queue", () => {
    it("returns editorial translation queue with missing categories", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/admin/v1/translations/queue",
        headers: { cookie: ownerCookie },
      });

      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data.stale).toBeDefined();
      expect(data.needsReview).toBeDefined();
      expect(data.missing).toBeDefined();
      expect(data.totalCount).toBeGreaterThan(0);

      const missingArabic = data.missing.find(
        (m: any) => m.contentId === testPostId && m.targetLocale === "ar-SA",
      );
      expect(missingArabic).toBeDefined();
    });
  });

  describe("GET /api/admin/v1/translations/health", () => {
    it("returns publication localization health and coverage breakdown", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/admin/v1/translations/health",
        headers: { cookie: ownerCookie },
      });

      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data.totalSourceItems).toBeGreaterThan(0);
      expect(data.byLocale["ar-SA"]).toBeDefined();
      expect(typeof data.overallCoveragePercentage).toBe("number");
    });
  });

  describe("Translation Editorial Lifecycle Endpoints", () => {
    it("creates a draft translation via POST /api/admin/v1/content/post/:id/translations", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/api/admin/v1/content/post/${testPostId}/translations`,
        headers: {
          cookie: ownerCookie,
          "content-type": "application/json",
          origin: "http://localhost:7777",
        },
        payload: {
          targetLocale: "ar-SA",
          title: `العنوان المترجم ${runSuffix}`,
          slug: arabicSlug,
          excerpt: "الملخص المترجم بالعربية",
          status: "draft",
        },
      });

      expect(res.statusCode).toBe(201);
      const data = res.json();
      expect(data.translation).toBeDefined();
      expect(data.translation.status).toBe("draft");
      expect(data.translation.targetLocale).toBe("ar-SA");
      createdTrId = data.translation.id;
    });

    it("retrieves full translation and source context via GET /api/admin/v1/translations/:id", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/admin/v1/translations/${createdTrId}`,
        headers: { cookie: ownerCookie },
      });

      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data.translation.id).toBe(createdTrId);
      expect(data.source).toBeDefined();
      expect(data.source.title).toContain("Integration Source Post");
    });

    it("updates translation fields via PATCH /api/admin/v1/translations/:id", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: `/api/admin/v1/translations/${createdTrId}`,
        headers: {
          cookie: ownerCookie,
          "content-type": "application/json",
          origin: "http://localhost:7777",
        },
        payload: {
          title: `العنوان المحدث ${runSuffix}`,
        },
      });

      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data.translation.title).toBe(`العنوان المحدث ${runSuffix}`);
    });

    it("submits translation for review via POST /api/admin/v1/translations/:id/submit-review", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/api/admin/v1/translations/${createdTrId}/submit-review`,
        headers: {
          cookie: ownerCookie,
          "content-type": "application/json",
          origin: "http://localhost:7777",
        },
        payload: {},
      });

      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data.translation.status).toBe("needs_review");
    });

    it("approves translation via POST /api/admin/v1/translations/:id/approve", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/api/admin/v1/translations/${createdTrId}/approve`,
        headers: {
          cookie: ownerCookie,
          "content-type": "application/json",
          origin: "http://localhost:7777",
        },
        payload: {},
      });

      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data.translation.status).toBe("approved");
    });

    it("publishes approved translation via POST /api/admin/v1/translations/:id/publish", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/api/admin/v1/translations/${createdTrId}/publish`,
        headers: {
          cookie: ownerCookie,
          "content-type": "application/json",
          origin: "http://localhost:7777",
        },
        payload: {},
      });

      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data.translation.status).toBe("published");
    });
  });

  describe("AI Translation Safety & Bulk Actions", () => {
    it("generates AI translation draft in 'needs_review' status (never auto-published)", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/api/admin/v1/content/post/${testPostId}/ai-translate`,
        headers: {
          cookie: ownerCookie,
          "content-type": "application/json",
          origin: "http://localhost:7777",
        },
        payload: {
          targetLocale: "fr-FR",
        },
      });

      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data.translation).toBeDefined();
      expect(data.translation.targetLocale).toBe("fr-FR");
      expect(data.translation.status).toBe("needs_review"); // Verified safety guarantee!
      expect(data.translation.translationProvider).toContain("ai:");
    });

    it("performs bulk operations safely via POST /api/admin/v1/translations/bulk", async () => {
      // Find the French translation just created
      const trs = await db
        .select()
        .from(contentTranslations)
        .where(eq(contentTranslations.contentId, testPostId));

      const frTr = trs.find((t) => t.targetLocale === "fr-FR");
      expect(frTr).toBeDefined();

      const bulkRes = await app.inject({
        method: "POST",
        url: "/api/admin/v1/translations/bulk",
        headers: {
          cookie: ownerCookie,
          "content-type": "application/json",
          origin: "http://localhost:7777",
        },
        payload: {
          translationIds: [frTr!.id],
          action: "approve",
        },
      });

      expect(bulkRes.statusCode).toBe(200);
      const bulkData = bulkRes.json();
      expect(bulkData.updatedCount).toBe(1);

      const refreshed = await db
        .select()
        .from(contentTranslations)
        .where(eq(contentTranslations.id, frTr!.id));
      expect(refreshed[0]?.status).toBe("approved");
    });
  });

  describe("Role-Based Access Control & Permission Gates", () => {
    let authorCookie: string;
    let editorCookie: string;

    beforeAll(async () => {
      // Ensure Author exists
      await ensureUserWithRole("author@vibress.local", "author", "DevPassword123!");

      // Login as Author
      const authorLogin = await app.inject({
        method: "POST",
        url: "/api/admin/v1/auth/login",
        payload: { email: "author@vibress.local", password: "DevPassword123!" },
      });
      expect(authorLogin.statusCode).toBe(200);
      const authorRaw = (authorLogin.headers["set-cookie"] as unknown as string) || "";
      authorCookie = authorRaw.split(";")[0] ?? "";

      // Ensure Editor exists
      await ensureUserWithRole("editor@vibress.local", "editor", "DevPassword123!");

      // Login as Editor
      const editorLogin = await app.inject({
        method: "POST",
        url: "/api/admin/v1/auth/login",
        payload: { email: "editor@vibress.local", password: "DevPassword123!" },
      });
      expect(editorLogin.statusCode).toBe(200);
      const editorRaw = (editorLogin.headers["set-cookie"] as unknown as string) || "";
      editorCookie = editorRaw.split(";")[0] ?? "";
    });

    it("rejects author when attempting to approve or publish a translation (403 Forbidden)", async () => {
      expect(authorCookie).toBeTruthy();

      const approveRes = await app.inject({
        method: "POST",
        url: `/api/admin/v1/translations/${createdTrId}/approve`,
        headers: {
          cookie: authorCookie,
          "content-type": "application/json",
          origin: "http://localhost:7777",
        },
        payload: {},
      });
      expect(approveRes.statusCode).toBe(403);

      const publishRes = await app.inject({
        method: "POST",
        url: `/api/admin/v1/translations/${createdTrId}/publish`,
        headers: {
          cookie: authorCookie,
          "content-type": "application/json",
          origin: "http://localhost:7777",
        },
        payload: {},
      });
      expect(publishRes.statusCode).toBe(403);
    });

    it("rejects editor when attempting bulk delete without translations.manage (403 Forbidden)", async () => {
      expect(editorCookie).toBeTruthy();

      const bulkDeleteRes = await app.inject({
        method: "POST",
        url: "/api/admin/v1/translations/bulk",
        headers: {
          cookie: editorCookie,
          "content-type": "application/json",
          origin: "http://localhost:7777",
        },
        payload: {
          translationIds: [createdTrId],
          action: "delete",
        },
      });
      expect(bulkDeleteRes.statusCode).toBe(403);
    });
  });

  describe("Field-Level Source Diff & Concurrency", () => {
    it("detects modified fields when source post is updated", async () => {
      // Modify source post
      await db
        .update(posts)
        .set({
          title: "Updated Source Title for Field Diff",
          content: { schema: "vibress-studio", version: 2, root: { type: "root", children: [{ type: "paragraph" }] } },
          updatedAt: new Date(Date.now() + 5000),
        })
        .where(eq(posts.id, testPostId));

      const res = await app.inject({
        method: "GET",
        url: `/api/admin/v1/translations/${createdTrId}`,
        headers: { cookie: ownerCookie },
      });

      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data.translation.fieldDiff).toBeDefined();
      expect(data.translation.fieldDiff.hasChanges).toBe(true);
      expect(data.translation.fieldDiff.titleChanged).toBe(true);
      expect(data.translation.fieldDiff.changedFields).toContain("title");
    });
  });
});

