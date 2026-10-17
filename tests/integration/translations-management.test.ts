import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../../apps/api/src/main";
import {
  getDb, posts, contentTranslations, users, settings, roles, userRoles,
  publicationLocales, publications, tags, postTags, eq, and, sql,
} from "@vibress/database";
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
  let previousArabicLocale: { status: string; isDefault: boolean } | null = null;
  let previousPrimaryLocale = "en";
  let previousSiteLocale: typeof settings.$inferSelect | null = null;
  let insertedArabicLocale = false;

  beforeAll(async () => {
    app = buildApp();
    await app.ready();

    // The legacy suite exercises a bilingual editorial workflow. The system
    // no longer implicitly activates Arabic, so explicitly enable it here.
    const [publicationBefore] = await db.select({ primaryLocale: publications.primaryLocale })
      .from(publications).where(eq(publications.id, "pub_default"));
    previousPrimaryLocale = publicationBefore?.primaryLocale ?? "en";
    if (previousPrimaryLocale !== "en") {
      await db.update(publications)
        .set({ primaryLocale: "en" })
        .where(eq(publications.id, "pub_default"));
    }
    const [localeSettingBefore] = await db.select().from(settings).where(and(
      eq(settings.publicationId, "pub_default"),
      eq(settings.namespace, "site"),
      eq(settings.key, "locale"),
    ));
    previousSiteLocale = localeSettingBefore ?? null;
    await db
      .delete(settings)
      .where(and(
        eq(settings.publicationId, "pub_default"),
        eq(settings.namespace, "site"),
        eq(settings.key, "locale"),
      ));
    const [existingArabic] = await db
      .select({ status: publicationLocales.status, isDefault: publicationLocales.isDefault })
      .from(publicationLocales)
      .where(and(
        eq(publicationLocales.publicationId, "pub_default"),
        eq(publicationLocales.locale, "ar-SA"),
      ));
    if (existingArabic) {
      previousArabicLocale = existingArabic;
      await db.update(publicationLocales)
        .set({ status: "active", isDefault: false })
        .where(and(
          eq(publicationLocales.publicationId, "pub_default"),
          eq(publicationLocales.locale, "ar-SA"),
        ));
    } else {
      insertedArabicLocale = true;
      await db.insert(publicationLocales).values({
        id: randomUUID(),
        publicationId: "pub_default",
        locale: "ar-SA",
        status: "active",
        isDefault: false,
      });
    }

    const [existingEnglish] = await db
      .select({ status: publicationLocales.status, isDefault: publicationLocales.isDefault })
      .from(publicationLocales)
      .where(and(
        eq(publicationLocales.publicationId, "pub_default"),
        eq(publicationLocales.locale, "en"),
      ));
    if (existingEnglish) {
      await db.update(publicationLocales)
        .set({ status: "active", isDefault: true })
        .where(and(
          eq(publicationLocales.publicationId, "pub_default"),
          eq(publicationLocales.locale, "en"),
        ));
    } else {
      await db.insert(publicationLocales).values({
        id: randomUUID(),
        publicationId: "pub_default",
        locale: "en",
        status: "active",
        isDefault: true,
      });
    }

    // Ensure pub_default starts with clean baseline: primary en, enabled [en, ar-SA]
    await db.delete(publicationLocales).where(and(
      eq(publicationLocales.publicationId, "pub_default"),
      sql`${publicationLocales.locale} NOT IN ('en', 'ar-SA')`,
    ));

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
      content: {
        schema: "vibress-studio",
        version: 1,
        root: {
          type: "root",
          children: [
            {
              type: "paragraph",
              children: [{ type: "text", text: "English source text for translation" }],
            },
          ],
        },
      },
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
    // Translations have no direct content_id foreign key; explicitly remove
    // all rows created by this suite to avoid polluting later test fixtures.
    await db.delete(contentTranslations).where(and(
      eq(contentTranslations.publicationId, "pub_default"),
      eq(contentTranslations.contentId, testPostId),
    ));
    await db.delete(posts).where(eq(posts.id, testPostId));
    if (previousSiteLocale) {
      await db.insert(settings).values(previousSiteLocale).onConflictDoUpdate({
        target: [settings.publicationId, settings.namespace, settings.key],
        set: {
          value: previousSiteLocale.value,
          updatedBy: previousSiteLocale.updatedBy,
          updatedAt: previousSiteLocale.updatedAt,
        },
      });
    }
    await db.update(publications).set({ primaryLocale: previousPrimaryLocale })
      .where(eq(publications.id, "pub_default"));
    if (insertedArabicLocale) {
      await db.delete(publicationLocales).where(and(
        eq(publicationLocales.publicationId, "pub_default"),
        eq(publicationLocales.locale, "ar-SA"),
      ));
    } else if (previousArabicLocale) {
      await db.update(publicationLocales)
        .set(previousArabicLocale)
        .where(and(
          eq(publicationLocales.publicationId, "pub_default"),
          eq(publicationLocales.locale, "ar-SA"),
        ));
    }
    if (app) await app.close();
  });

  describe("Publication language configuration API", () => {
    it("requires authentication to read the publication's languages", async () => {
      const res = await app.inject({ method: "GET", url: "/api/admin/v1/locales" });
      expect(res.statusCode).toBe(401);
    });

    it("returns only configured languages under the authenticated publication context", async () => {
      const res = await app.inject({
        method: "GET", url: "/api/admin/v1/locales",
        headers: { cookie: ownerCookie },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        primaryLocale: "en",
        enabledLocales: ["en", "ar-SA"],
        isMultilingual: true,
      });
    });

    it("does not allow unauthenticated users to change language configuration", async () => {
      const res = await app.inject({
        method: "PUT",
        url: "/api/admin/v1/locales",
        headers: { origin: "http://localhost:7777" },
        payload: { primaryLocale: "en", enabledLocales: ["en", "ar-SA"] },
      });
      expect(res.statusCode).toBe(401);
    });

    it("does not grant an Author permission to change publication languages", async () => {
      await ensureUserWithRole(
        "language.author@example.com", "Author", "AuthorLanguagePassword123!",
      );
      const login = await app.inject({
        method: "POST",
        url: "/api/admin/v1/auth/login",
        payload: {
          email: "language.author@example.com",
          password: "AuthorLanguagePassword123!",
        },
      });
      expect(login.statusCode).toBe(200);
      const header = login.headers["set-cookie"];
      const rawCookie = Array.isArray(header) ? header[0] : header;
      const cookie = typeof rawCookie === "string" ? (rawCookie.split(";")[0] ?? "") : "";
      const res = await app.inject({
        method: "PUT",
        url: "/api/admin/v1/locales",
        headers: { cookie, origin: "http://localhost:7777" },
        payload: { primaryLocale: "en", enabledLocales: ["en", "ar-SA"] },
      });
      expect(res.statusCode).toBe(403);
    });

    it("enforces the origin protection on locale writes", async () => {
      const res = await app.inject({
        method: "PUT",
        url: "/api/admin/v1/locales",
        headers: { cookie: ownerCookie, origin: "https://untrusted.example.com" },
        payload: { primaryLocale: "en", enabledLocales: ["en", "ar-SA"] },
      });
      expect(res.statusCode).toBe(403);
    });

    it("rejects invalid and duplicated language configuration without changing state", async () => {
      const res = await app.inject({
        method: "PUT",
        url: "/api/admin/v1/locales",
        headers: { cookie: ownerCookie, origin: "http://localhost:7777" },
        payload: { primaryLocale: "en", enabledLocales: ["en", "en"] },
      });
      expect(res.statusCode).toBe(400);
      const after = await app.inject({
        method: "GET", url: "/api/admin/v1/locales",
        headers: { cookie: ownerCookie },
      });
      expect(after.json().enabledLocales).toEqual(["en", "ar-SA"]);
    });

    it("blocks legacy site.locale changes on a publication with existing source content", async () => {
      const res = await app.inject({
        method: "PUT",
        url: "/api/admin/v1/settings/site/locale",
        headers: { cookie: ownerCookie, origin: "http://localhost:7777" },
        payload: { value: "ar" },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().errors[0].code).toBe("PRIMARY_LOCALE_CHANGE_REQUIRES_MIGRATION");
    });

    it("strictly guards changing the primary language of a populated publication", async () => {
      const res = await app.inject({
        method: "PUT",
        url: "/api/admin/v1/locales",
        headers: { cookie: ownerCookie, origin: "http://localhost:7777" },
        payload: {
          primaryLocale: "ar",
          enabledLocales: ["ar", "en"],
        },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().errors[0].code).toBe("PRIMARY_LOCALE_CHANGE_REQUIRES_MIGRATION");
      expect(res.json().errors[0].message).toContain("content migration");
    });

    it("guards disabling a language with published URLs unless confirmed via confirmPublishedUrlRetirement", async () => {
      const enableRes = await app.inject({
        method: "PUT",
        url: "/api/admin/v1/locales",
        headers: { cookie: ownerCookie, origin: "http://localhost:7777" },
        payload: {
          primaryLocale: "en",
          enabledLocales: ["en", "ar-SA", "de-DE"],
        },
      });
      expect(enableRes.statusCode).toBe(200);

      const trId = randomUUID();
      await db.insert(contentTranslations).values({
        id: trId,
        publicationId: "pub_default",
        contentType: "post",
        contentId: testPostId,
        targetLocale: "de-DE",
        status: "published",
        title: "German Title",
        slug: `german-post-${runSuffix}`,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      try {
        const failRes = await app.inject({
          method: "PUT",
          url: "/api/admin/v1/locales",
          headers: { cookie: ownerCookie, origin: "http://localhost:7777" },
          payload: {
            primaryLocale: "en",
            enabledLocales: ["en", "ar-SA"],
          },
        });
        expect(failRes.statusCode).toBe(409);
        expect(failRes.json().errors[0].code).toBe("PUBLISHED_LOCALE_REQUIRES_REVIEW");

        const successRes = await app.inject({
          method: "PUT",
          url: "/api/admin/v1/locales",
          headers: { cookie: ownerCookie, origin: "http://localhost:7777" },
          payload: {
            primaryLocale: "en",
            enabledLocales: ["en", "ar-SA"],
            confirmPublishedUrlRetirement: true,
          },
        });
        expect(successRes.statusCode).toBe(200);
        expect(successRes.json().enabledLocales).toEqual(["en", "ar-SA"]);

        const getRes = await app.inject({
          method: "GET",
          url: "/api/admin/v1/locales",
          headers: { cookie: ownerCookie },
        });
        expect(getRes.statusCode).toBe(200);
        expect(getRes.json().enabledLocales).toEqual(["en", "ar-SA"]);
        expect(getRes.json().needsReconciliation).toBe(false);
      } finally {
        await db.delete(contentTranslations).where(eq(contentTranslations.id, trId));
        await db.delete(publicationLocales).where(and(
          eq(publicationLocales.publicationId, "pub_default"),
          eq(publicationLocales.locale, "de-DE"),
        ));
      }
    });
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

  describe("Translation write boundary regression", () => {
    it("rejects direct creation of a published translation", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/api/admin/v1/content/post/${testPostId}/translations`,
        headers: { cookie: ownerCookie, origin: "http://localhost:7777" },
        payload: {
          targetLocale: "ar-SA",
          title: "Unreviewed text", slug: `unreviewed-${runSuffix}`,
          status: "published",
        },
      });
      expect(response.statusCode).toBe(409);
    });

    it("rejects creating a translation in a disabled language", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/api/admin/v1/content/post/${testPostId}/translations`,
        headers: { cookie: ownerCookie, origin: "http://localhost:7777" },
        payload: {
          targetLocale: "ja", title: "Disabled text",
          slug: `disabled-${runSuffix}`, status: "draft",
        },
      });
      expect(response.statusCode).toBe(404);
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

    it("rejects a duplicate create request without overwriting existing content", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/api/admin/v1/content/post/${testPostId}/translations`,
        headers: { cookie: ownerCookie, origin: "http://localhost:7777" },
        payload: {
          targetLocale: "ar-sa",
          title: "Overwritten title",
          slug: `another-${runSuffix}`,
        },
      });
      expect(res.statusCode).toBe(409);
      const [stored] = await db.select().from(contentTranslations)
        .where(eq(contentTranslations.id, createdTrId));
      expect(stored?.title).not.toBe("Overwritten title");
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

    it("prevents changing the target language of an existing translation", async () => {
      const response = await app.inject({
        method: "PATCH", url: `/api/admin/v1/translations/${createdTrId}`,
        headers: { cookie: ownerCookie, origin: "http://localhost:7777" },
        payload: { targetLocale: "fr-FR" },
      });
      expect(response.statusCode).toBe(409);
    });

    it("prevents changing the translation state to published via a generic PATCH", async () => {
      const response = await app.inject({
        method: "PATCH", url: `/api/admin/v1/translations/${createdTrId}`,
        headers: { cookie: ownerCookie, origin: "http://localhost:7777" },
        payload: { status: "published" },
      });
      expect([403, 409]).toContain(response.statusCode);
    });

    it("rejects publishing a draft without prior approval", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/api/admin/v1/translations/${createdTrId}/publish`,
        headers: { cookie: ownerCookie, origin: "http://localhost:7777" },
      });
      expect(res.statusCode).toBe(400);
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

    it("rejects publishing a reviewed but unapproved draft", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/api/admin/v1/translations/${createdTrId}/publish`,
        headers: { cookie: ownerCookie, origin: "http://localhost:7777" },
      });
      expect(res.statusCode).toBe(400);
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

  describe("Translated pagination", () => {
    it("paginates published translations before filtering the original-language source", async () => {
      const tagId = randomUUID();
      const untranslatedId = randomUUID();
      const tagSlug = `locale-pagination-${runSuffix}`;
      await db.insert(tags).values({
        id: tagId,
        publicationId: "pub_default",
        name: "Localization pagination",
        slug: tagSlug,
      });
      await db.insert(posts).values({
        id: untranslatedId,
        publicationId: "pub_default",
        title: "More recent English-only source",
        slug: `untranslated-${runSuffix}`,
        content: { version: 1, root: {} },
        status: "published",
        visibility: "public",
        primaryAuthorId: ownerId,
        createdBy: ownerId,
        updatedBy: ownerId,
        publishedAt: new Date(),
      });
      await db.insert(postTags).values([
        { publicationId: "pub_default", tagId, postId: untranslatedId },
        { publicationId: "pub_default", tagId, postId: testPostId },
      ]);
      try {
        const result = await app.inject({
          method: "GET",
          url: `/api/content/v1/posts?locale=ar-SA&limit=1&page=1&tag=${tagSlug}`,
        });
        expect(result.statusCode).toBe(200);
        const data = result.json();
        expect(data.pagination.total).toBe(1);
        expect(data.pagination.pages).toBe(1);
        expect(data.posts).toHaveLength(1);
        expect(data.posts[0].slug).toBe(arabicSlug);
      } finally {
        await db.delete(postTags).where(eq(postTags.tagId, tagId));
        await db.delete(posts).where(eq(posts.id, untranslatedId));
        await db.delete(tags).where(eq(tags.id, tagId));
      }
    });
  });

  describe("Regional language isolation", () => {
    it("does not substitute ar-SA when ar-EG is explicitly requested", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/api/content/v1/posts/${arabicSlug}?locale=ar-EG`,
      });
      // The publication only enables ar-SA. A base-language match cannot
      // bypass that feature policy or make an unrelated variant public.
      expect(response.statusCode).toBe(404);
    });

    it("supports exact translation lookups without breaking the legacy fallback API", async () => {
      const { TranslationService } = await import("@vibress/i18n/server");
      const translations = new TranslationService();
      const exact = await translations.getTranslation(
        "post", testPostId, "ar-EG", undefined, "pub_default", true,
      );
      expect(exact).toBeNull();
      const matching = await translations.getTranslation(
        "post", testPostId, "ar-SA", undefined, "pub_default", true,
      );
      expect(matching?.targetLocale).toBe("ar-SA");
    });
  });

  describe("Published translation protection", () => {
    it("never exposes a future-dated source through a published localized slug", async () => {
      const sourceId = randomUUID();
      const translationId = randomUUID();
      const sourceSlug = `future-source-${sourceId.slice(0, 8)}`;
      const translatedSlug = `future-translation-${translationId.slice(0, 8)}`;
      const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await db.insert(posts).values({
        id: sourceId,
        publicationId: "pub_default",
        title: "Future Source",
        slug: sourceSlug,
        content: { version: 1, root: {} },
        status: "published",
        visibility: "public",
        publishedAt: future,
        primaryAuthorId: ownerId,
        createdBy: ownerId,
        updatedBy: ownerId,
      });
      await db.insert(contentTranslations).values({
        id: translationId,
        publicationId: "pub_default",
        contentType: "post",
        contentId: sourceId,
        sourceLocale: "en",
        targetLocale: "ar-SA",
        title: "مقال مستقبلي",
        slug: translatedSlug,
        status: "published",
        content: { version: 1, root: {} },
      });
      try {
        const localized = await app.inject({
          method: "GET",
          url: `/api/content/v1/posts/${translatedSlug}?locale=ar-SA`,
        });
        expect(localized.statusCode).toBe(404);
        const legacy = await app.inject({
          method: "GET",
          url: `/api/content/v1/legacy-translation/resolve?type=post&slug=${translatedSlug}`,
        });
        expect(legacy.statusCode).toBe(404);
      } finally {
        await db.delete(contentTranslations).where(eq(contentTranslations.id, translationId));
        await db.delete(posts).where(eq(posts.id, sourceId));
      }
    });

    it("rejects changing live translated text without reopening review", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: `/api/admin/v1/translations/${createdTrId}`,
        headers: { cookie: ownerCookie, origin: "http://localhost:7777" },
        payload: { title: "Unreviewed live edit" },
      });
      expect(res.statusCode).toBe(409);
      const [saved] = await db.select().from(contentTranslations)
        .where(eq(contentTranslations.id, createdTrId));
      expect(saved?.title).not.toBe("Unreviewed live edit");
    });

    it("rejects AI regeneration over a published translation", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/api/admin/v1/content/post/${testPostId}/ai-translate`,
        headers: { cookie: ownerCookie, origin: "http://localhost:7777" },
        payload: { targetLocale: "ar-sa" },
      });
      expect(res.statusCode).toBe(409);
    });
  });

  describe("Published legacy translation URL compatibility", () => {
    it("resolves a unique public translated slug to a canonical enabled path", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/api/content/v1/legacy-translation/resolve?type=post&slug=${encodeURIComponent(arabicSlug)}`,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().path).toBe(`/ar/posts/${arabicSlug}`);
    });

    it("does not reveal drafts or unknown slugs", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/content/v1/legacy-translation/resolve?type=post&slug=missing-translation",
      });
      expect(response.statusCode).toBe(404);
    });
  });

  describe("AI Translation Safety & Bulk Actions", () => {
    beforeAll(async () => {
      await app.inject({
        method: "PUT",
        url: "/api/admin/v1/locales",
        headers: {
          cookie: ownerCookie,
          "content-type": "application/json",
          origin: "http://localhost:7777",
        },
        payload: {
          primaryLocale: "en",
          enabledLocales: ["en", "ar-SA", "fr-FR"],
        },
      });
    });

    it("fails safely on an incomplete provider response without writing a fake draft", async () => {
      // The integration environment intentionally has no configured AI
      // translation provider. An outage must not save source text as translated.
      const res = await app.inject({
        method: "POST",
        url: `/api/admin/v1/content/post/${testPostId}/ai-translate`,
        headers: {
          cookie: ownerCookie,
          "content-type": "application/json",
          origin: "http://localhost:7777",
        },
        payload: { targetLocale: "fr-FR" },
      });
      expect(res.statusCode).toBe(502);
      const records = await db.select().from(contentTranslations).where(and(
        eq(contentTranslations.publicationId, "pub_default"),
        eq(contentTranslations.contentId, testPostId),
        eq(contentTranslations.targetLocale, "fr-FR"),
      ));
      expect(records).toHaveLength(0);
    });

    it("prepares a reviewed human French draft for the bulk lifecycle test", async () => {
      const created = await app.inject({
        method: "POST",
        url: `/api/admin/v1/content/post/${testPostId}/translations`,
        headers: { cookie: ownerCookie, origin: "http://localhost:7777" },
        payload: {
          targetLocale: "fr-FR", title: "Article français",
          slug: `${postSlug}-fr`, excerpt: "Description française",
          content: { schema: "vibress-studio", version: 1, root: { children: [] } },
        },
      });
      expect(created.statusCode).toBe(201);
      const id = created.json().translation.id as string;
      const review = await app.inject({
        method: "POST", url: `/api/admin/v1/translations/${id}/submit-review`,
        headers: { cookie: ownerCookie, origin: "http://localhost:7777" },
      });
      expect(review.statusCode).toBe(200);
      expect(review.json().translation.status).toBe("needs_review");
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

    afterAll(async () => {
      await db.delete(contentTranslations).where(and(
        eq(contentTranslations.publicationId, "pub_default"),
        eq(contentTranslations.targetLocale, "fr-FR"),
      ));
      await app.inject({
        method: "PUT",
        url: "/api/admin/v1/locales",
        headers: {
          cookie: ownerCookie,
          "content-type": "application/json",
          origin: "http://localhost:7777",
        },
        payload: {
          primaryLocale: "en",
          enabledLocales: ["en", "ar-SA"],
        },
      });
      await db.delete(publicationLocales).where(and(
        eq(publicationLocales.publicationId, "pub_default"),
        eq(publicationLocales.locale, "fr-FR"),
      ));
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

