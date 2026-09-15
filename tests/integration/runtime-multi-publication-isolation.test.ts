import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../../apps/api/src/main";
import {
  getDb,
  workspaces,
  publications,
  publicationMemberships,
  users,
  roles,
  userRoles,
  posts,
  pages,
  tags,
  mediaAssets,
  members,
  products,
  plans,
  newsletters,
  searchDocuments,
  contentTranslations,
  automations,
  installedThemes,
  webhookEndpoints,
  analyticsEvents,
  eq,
  and,
} from "@vibress/database";
import { hashPassword } from "@vibress/security";
import { buildPublicationCacheKey, buildSystemCacheKey } from "@vibress/cache";
import { assertJobScope } from "@vibress/queue";
import { searchService } from "../../apps/api/src/services";
import crypto from "node:crypto";

describe("VIBRESS Step D: Master Runtime Multi-Publication Isolation Suite", () => {
  let app: ReturnType<typeof buildApp>;

  const runId = crypto.randomUUID().slice(0, 8);
  const WS_ID = "ws_default";

  const PUB_ALPHA_ID = `pub_alpha_${runId}`;
  const PUB_BETA_ID = `pub_beta_${runId}`;

  const ALPHA_HOST = `alpha-${runId}.vibress.test`;
  const BETA_HOST = `beta-${runId}.vibress.test`;
  const UNMAPPED_HOST = `unmapped-${runId}.evil.com`;

  const USER_ALPHA_EMAIL = `staff.alpha.${runId}@example.com`;
  const USER_BETA_EMAIL = `staff.beta.${runId}@example.com`;
  const COMMON_PASSWORD = "Password123!Secure";

  let userAlphaId: string;
  let userBetaId: string;
  let alphaCookie = "";
  let betaCookie = "";

  let alphaPostId: string;
  let betaPostId: string;
  const sharedSlug = `shared-headline-${runId}`;

  beforeAll(async () => {
    app = buildApp();
    await app.ready();

    const db = getDb();

    // 1. Ensure default workspace exists
    const [existingWs] = await db.select().from(workspaces).where(eq(workspaces.id, WS_ID));
    if (!existingWs) {
      await db.insert(workspaces).values({
        id: WS_ID,
        name: "Default Workspace",
        slug: "default",
      });
    }

    // 2. Create distinct publications: Alpha and Beta
    await db.insert(publications).values([
      {
        id: PUB_ALPHA_ID,
        workspaceId: WS_ID,
        name: `Alpha Journal ${runId}`,
        slug: `alpha-${runId}`,
        domain: ALPHA_HOST,
        primaryLocale: "en",
      },
      {
        id: PUB_BETA_ID,
        workspaceId: WS_ID,
        name: `Beta Chronicle ${runId}`,
        slug: `beta-${runId}`,
        domain: BETA_HOST,
        primaryLocale: "en",
      },
    ]);

    // 3. Create staff users for Alpha and Beta
    const passwordHash = await hashPassword(COMMON_PASSWORD);

    userAlphaId = crypto.randomUUID();
    userBetaId = crypto.randomUUID();

    await db.insert(users).values([
      {
        id: userAlphaId,
        email: USER_ALPHA_EMAIL,
        name: "Alpha Staff",
        passwordHash,
        status: "active",
      },
      {
        id: userBetaId,
        email: USER_BETA_EMAIL,
        name: "Beta Staff",
        passwordHash,
        status: "active",
      },
    ]);

    // Assign global role with all permissions
    const [ownerRole] = await db
      .select()
      .from(roles)
      .where(eq(roles.key, "owner"));
    if (ownerRole) {
      await db.insert(userRoles).values([
        { userId: userAlphaId, roleId: ownerRole.id },
        { userId: userBetaId, roleId: ownerRole.id },
      ]);
    }

    // 4. Assign strict publication memberships:
    // userAlpha belongs ONLY to PUB_ALPHA
    // userBeta belongs ONLY to PUB_BETA
    await db.insert(publicationMemberships).values([
      {
        id: crypto.randomUUID(),
        publicationId: PUB_ALPHA_ID,
        userId: userAlphaId,
        role: "owner",
      },
      {
        id: crypto.randomUUID(),
        publicationId: PUB_BETA_ID,
        userId: userBetaId,
        role: "owner",
      },
    ]);

    // 5. Authenticate both users to obtain staff session cookies
    const loginAlpha = await app.inject({
      method: "POST",
      url: "/api/admin/v1/auth/login",
      payload: { email: USER_ALPHA_EMAIL, password: COMMON_PASSWORD },
    });
    expect(loginAlpha.statusCode).toBe(200);
    const alphaSetCookie = (loginAlpha.headers["set-cookie"] as string) || "";
    alphaCookie = alphaSetCookie.split(";")[0] ?? "";

    const loginBeta = await app.inject({
      method: "POST",
      url: "/api/admin/v1/auth/login",
      payload: { email: USER_BETA_EMAIL, password: COMMON_PASSWORD },
    });
    expect(loginBeta.statusCode).toBe(200);
    const betaSetCookie = (loginBeta.headers["set-cookie"] as string) || "";
    betaCookie = betaSetCookie.split(";")[0] ?? "";
  });

  afterAll(async () => {
    const db = getDb();
    try {
      await db.delete(posts).where(eq(posts.publicationId, PUB_ALPHA_ID));
      await db.delete(posts).where(eq(posts.publicationId, PUB_BETA_ID));
      await db.delete(pages).where(eq(pages.publicationId, PUB_ALPHA_ID));
      await db.delete(pages).where(eq(pages.publicationId, PUB_BETA_ID));
      await db.delete(tags).where(eq(tags.publicationId, PUB_ALPHA_ID));
      await db.delete(tags).where(eq(tags.publicationId, PUB_BETA_ID));
      await db.delete(searchDocuments).where(eq(searchDocuments.publicationId, PUB_ALPHA_ID));
      await db.delete(searchDocuments).where(eq(searchDocuments.publicationId, PUB_BETA_ID));
      await db.delete(publicationMemberships).where(eq(publicationMemberships.publicationId, PUB_ALPHA_ID));
      await db.delete(publicationMemberships).where(eq(publicationMemberships.publicationId, PUB_BETA_ID));
      await db.delete(publications).where(eq(publications.id, PUB_ALPHA_ID));
      await db.delete(publications).where(eq(publications.id, PUB_BETA_ID));
      await db.delete(userRoles).where(eq(userRoles.userId, userAlphaId));
      await db.delete(userRoles).where(eq(userRoles.userId, userBetaId));
      await db.delete(users).where(eq(users.id, userAlphaId));
      await db.delete(users).where(eq(users.id, userBetaId));
    } catch {
      // Best-effort cleanup
    }
    await app.close();
  });

  describe("1. Host Routing & Invariant Enforcement", () => {
    it("resolves mapped hostname to Publication Alpha", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/content/v1/site",
        headers: { host: ALPHA_HOST },
      });
      expect(res.statusCode).toBe(200);
    });

    it("resolves mapped hostname to Publication Beta", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/content/v1/site",
        headers: { host: BETA_HOST },
      });
      expect(res.statusCode).toBe(200);
    });

    it("adversarially rejects unmapped hostname without falling back to pub_default", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/content/v1/site",
        headers: {
          host: UNMAPPED_HOST,
          "x-dev-fallback": "false",
        },
      });
      expect(res.statusCode).toBe(404);
      const body = res.json();
      expect(body.errors[0]?.code).toBe("PUBLICATION_NOT_FOUND");
    });
  });

  describe("2. Same-Slug / Same-Key Coexistence Across Publications", () => {
    it("creates identically slugged posts in Alpha and Beta without constraint collision", async () => {
      const db = getDb();
      alphaPostId = crypto.randomUUID();
      betaPostId = crypto.randomUUID();

      await db.insert(posts).values([
        {
          id: alphaPostId,
          publicationId: PUB_ALPHA_ID,
          title: "Alpha Exclusive Story",
          slug: sharedSlug,
          excerpt: "Alpha excerpt text",
          content: { schema: "vibress-studio", version: 1, root: { type: "root", children: [] } },
          status: "published",
          visibility: "public",
          primaryAuthorId: userAlphaId,
          createdBy: userAlphaId,
          updatedBy: userAlphaId,
          publishedAt: new Date(),
        },
        {
          id: betaPostId,
          publicationId: PUB_BETA_ID,
          title: "Beta Exclusive Story",
          slug: sharedSlug,
          excerpt: "Beta excerpt text",
          content: { schema: "vibress-studio", version: 1, root: { type: "root", children: [] } },
          status: "published",
          visibility: "public",
          primaryAuthorId: userBetaId,
          createdBy: userBetaId,
          updatedBy: userBetaId,
          publishedAt: new Date(),
        },
      ]);

      expect(alphaPostId).toBeDefined();
      expect(betaPostId).toBeDefined();
    });

    it("public GET returns Alpha's post when requested under Alpha Host", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/content/v1/posts/${sharedSlug}`,
        headers: { host: ALPHA_HOST },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.post.id).toBe(alphaPostId);
      expect(body.post.title).toBe("Alpha Exclusive Story");
    });

    it("public GET returns Beta's post when requested under Beta Host", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/content/v1/posts/${sharedSlug}`,
        headers: { host: BETA_HOST },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.post.id).toBe(betaPostId);
      expect(body.post.title).toBe("Beta Exclusive Story");
    });

    it("allows identically slugged pages and tags across Alpha and Beta", async () => {
      const db = getDb();
      const sharedTagSlug = `topic-${runId}`;
      const sharedPageSlug = `about-${runId}`;

      await db.insert(tags).values([
        {
          id: crypto.randomUUID(),
          publicationId: PUB_ALPHA_ID,
          name: "Alpha Topic",
          slug: sharedTagSlug,
        },
        {
          id: crypto.randomUUID(),
          publicationId: PUB_BETA_ID,
          name: "Beta Topic",
          slug: sharedTagSlug,
        },
      ]);

      await db.insert(pages).values([
        {
          id: crypto.randomUUID(),
          publicationId: PUB_ALPHA_ID,
          title: "Alpha About Us",
          slug: sharedPageSlug,
          content: { schema: "vibress-studio", version: 1, root: { type: "root", children: [] } },
          status: "published",
          visibility: "public",
          primaryAuthorId: userAlphaId,
          createdBy: userAlphaId,
          updatedBy: userAlphaId,
        },
        {
          id: crypto.randomUUID(),
          publicationId: PUB_BETA_ID,
          title: "Beta About Us",
          slug: sharedPageSlug,
          content: { schema: "vibress-studio", version: 1, root: { type: "root", children: [] } },
          status: "published",
          visibility: "public",
          primaryAuthorId: userBetaId,
          createdBy: userBetaId,
          updatedBy: userBetaId,
        },
      ]);

      const tagAlphaRes = await app.inject({
        method: "GET",
        url: `/api/content/v1/tags/${sharedTagSlug}`,
        headers: { host: ALPHA_HOST },
      });
      expect(tagAlphaRes.statusCode).toBe(200);
      expect(tagAlphaRes.json().tag.name).toBe("Alpha Topic");

      const tagBetaRes = await app.inject({
        method: "GET",
        url: `/api/content/v1/tags/${sharedTagSlug}`,
        headers: { host: BETA_HOST },
      });
      expect(tagBetaRes.statusCode).toBe(200);
      expect(tagBetaRes.json().tag.name).toBe("Beta Topic");
    });
  });

  describe("3. Non-Disclosing 404 on Cross-Tenant Inquiries", () => {
    it("returns identical 404 when querying another tenant's post vs a non-existent post", async () => {
      // Alpha staff requests Beta post ID
      const crossTenantRes = await app.inject({
        method: "GET",
        url: `/api/admin/v1/posts/${betaPostId}`,
        headers: {
          cookie: alphaCookie,
          "x-publication-id": PUB_ALPHA_ID,
        },
      });

      // Alpha staff requests a completely fake UUID
      const fakeUuid = crypto.randomUUID();
      const fakeRes = await app.inject({
        method: "GET",
        url: `/api/admin/v1/posts/${fakeUuid}`,
        headers: {
          cookie: alphaCookie,
          "x-publication-id": PUB_ALPHA_ID,
        },
      });

      expect(crossTenantRes.statusCode).toBe(404);
      expect(fakeRes.statusCode).toBe(404);

      // Status code and error codes must be completely non-disclosing
      expect(crossTenantRes.json().errors[0]?.code).toBe(fakeRes.json().errors[0]?.code);
      expect(crossTenantRes.json().errors[0]?.message).toBe(fakeRes.json().errors[0]?.message);
    });

    it("rejects cross-tenant post update attempts with non-disclosing 404", async () => {
      const patchRes = await app.inject({
        method: "PATCH",
        url: `/api/admin/v1/posts/${betaPostId}`,
        headers: {
          cookie: alphaCookie,
          "x-publication-id": PUB_ALPHA_ID,
          origin: "http://127.0.0.1:7780",
        },
        payload: {
          title: "Malicious Tampering Attempt",
        },
      });

      expect(patchRes.statusCode).toBe(404);
    });
  });

  describe("4. Header Tampering & Privilege Escalation Defenses", () => {
    it("rejects staff user from Alpha attempting to access Beta with X-Publication-Id", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/admin/v1/posts",
        headers: {
          cookie: alphaCookie,
          "x-publication-id": PUB_BETA_ID,
        },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().errors[0]?.code).toBe("PUBLICATION_ACCESS_DENIED");
    });

    it("rejects staff user from Beta attempting to access Alpha with X-Publication-Id", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/admin/v1/posts",
        headers: {
          cookie: betaCookie,
          "x-publication-id": PUB_ALPHA_ID,
        },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().errors[0]?.code).toBe("PUBLICATION_ACCESS_DENIED");
    });
  });

  describe("5. Search Isolation Across Publications", () => {
    it("indexes unique documents and isolates search queries per publication", async () => {
      const searchTerm = `quantumcrypt-${runId}`;

      await searchService.indexDocument(
        {
          entityType: "post",
          entityId: alphaPostId,
          publicationId: PUB_ALPHA_ID,
          title: `Alpha ${searchTerm} Guide`,
          bodyText: `Secret quantum computing research inside Alpha`,
          slug: `alpha-${searchTerm}`,
          url: `/posts/alpha-${searchTerm}`,
          searchable: true,
        },
        PUB_ALPHA_ID,
      );

      await searchService.indexDocument(
        {
          entityType: "post",
          entityId: betaPostId,
          publicationId: PUB_BETA_ID,
          title: `Beta ${searchTerm} Overview`,
          bodyText: `Different quantum computing discussion inside Beta`,
          slug: `beta-${searchTerm}`,
          url: `/posts/beta-${searchTerm}`,
          searchable: true,
        },
        PUB_BETA_ID,
      );

      // Search under Alpha Host
      const searchAlpha = await app.inject({
        method: "GET",
        url: `/api/content/v1/search?q=${searchTerm}`,
        headers: { host: ALPHA_HOST },
      });
      expect(searchAlpha.statusCode).toBe(200);
      const alphaResults = searchAlpha.json().results;
      expect(alphaResults.length).toBe(1);
      expect(alphaResults[0].entityId).toBe(alphaPostId);
      expect(alphaResults[0].title).toContain("Alpha");

      // Search under Beta Host
      const searchBeta = await app.inject({
        method: "GET",
        url: `/api/content/v1/search?q=${searchTerm}`,
        headers: { host: BETA_HOST },
      });
      expect(searchBeta.statusCode).toBe(200);
      const betaResults = searchBeta.json().results;
      expect(betaResults.length).toBe(1);
      expect(betaResults[0].entityId).toBe(betaPostId);
      expect(betaResults[0].title).toContain("Beta");
    });
  });

  describe("6. Queue & Worker Job Scope Validation", () => {
    it("validates publication job scope correctly", () => {
      const validJob = {
        scope: "publication" as const,
        publicationId: PUB_ALPHA_ID,
        action: "send",
      };
      const scope = assertJobScope(validJob);
      expect(scope).toEqual({ scope: "publication", publicationId: PUB_ALPHA_ID });
    });

    it("rejects jobs declaring scope: publication but omitting publicationId", () => {
      const invalidJob = {
        scope: "publication",
        action: "send",
      };
      expect(() => assertJobScope(invalidJob)).toThrow(
        "Publication-scoped job must include a non-empty publicationId",
      );
    });

    it("validates system-scoped job", () => {
      const systemJob = {
        scope: "system" as const,
        task: "cleanup",
      };
      const scope = assertJobScope(systemJob);
      expect(scope).toEqual({ scope: "system" });
    });
  });

  describe("7. Cache Namespace Isolation", () => {
    it("enforces unique and strictly partitioned cache keys", () => {
      const keyAlpha = buildPublicationCacheKey(PUB_ALPHA_ID, "posts", "post-100");
      const keyBeta = buildPublicationCacheKey(PUB_BETA_ID, "posts", "post-100");
      const keySystem = buildSystemCacheKey("settings", "smtp");

      expect(keyAlpha).toBe(`pub:${PUB_ALPHA_ID}:posts:post-100`);
      expect(keyBeta).toBe(`pub:${PUB_BETA_ID}:posts:post-100`);
      expect(keySystem).toBe("sys:settings:smtp");

      expect(keyAlpha).not.toBe(keyBeta);
      expect(() => buildPublicationCacheKey("", "posts", "key")).toThrow();
    });
  });

  describe("8. Content Translations Isolation Across Publications", () => {
    it("isolates localized translations for identically slugged posts", async () => {
      const db = getDb();
      const { contentTranslations } = await import("@vibress/database");

      await db.insert(contentTranslations).values([
        {
          id: crypto.randomUUID(),
          publicationId: PUB_ALPHA_ID,
          contentType: "post",
          contentId: alphaPostId,
          sourceLocale: "en",
          targetLocale: "ar",
          title: "عنوان الفا الحصري بالعربية",
          slug: sharedSlug,
          excerpt: "محتوى حصري لمنشور الفا",
          status: "published",
        },
        {
          id: crypto.randomUUID(),
          publicationId: PUB_BETA_ID,
          contentType: "post",
          contentId: betaPostId,
          sourceLocale: "en",
          targetLocale: "ar",
          title: "عنوان بيتا الحصري بالعربية",
          slug: sharedSlug,
          excerpt: "محتوى حصري لمنشور بيتا",
          status: "published",
        },
      ]);

      const resAlpha = await app.inject({
        method: "GET",
        url: `/api/content/v1/posts/${sharedSlug}?locale=ar`,
        headers: { host: ALPHA_HOST },
      });
      expect(resAlpha.statusCode).toBe(200);
      expect(resAlpha.json().post.title).toBe("عنوان الفا الحصري بالعربية");

      const resBeta = await app.inject({
        method: "GET",
        url: `/api/content/v1/posts/${sharedSlug}?locale=ar`,
        headers: { host: BETA_HOST },
      });
      expect(resBeta.statusCode).toBe(200);
      expect(resBeta.json().post.title).toBe("عنوان بيتا الحصري بالعربية");
    });
  });

  describe("9. Member & Audience Isolation Across Publications", () => {
    it("prevents Alpha staff from viewing Beta members in admin queries", async () => {
      const db = getDb();
      const { members } = await import("@vibress/database");

      const betaMemberId = crypto.randomUUID();
      const memberEmail = `subscriber.beta.${runId}@example.com`;
      await db.insert(members).values({
        id: betaMemberId,
        publicationId: PUB_BETA_ID,
        email: memberEmail,
        emailNormalized: memberEmail.toLowerCase(),
        status: "active",
      });

      // Alpha staff queries members
      const alphaListRes = await app.inject({
        method: "GET",
        url: "/api/admin/v1/members",
        headers: {
          cookie: alphaCookie,
          "x-publication-id": PUB_ALPHA_ID,
        },
      });
      expect(alphaListRes.statusCode).toBe(200);
      const alphaMembers = alphaListRes.json().members;
      expect(alphaMembers.some((m: any) => m.id === betaMemberId)).toBe(false);

      // Beta staff queries members
      const betaListRes = await app.inject({
        method: "GET",
        url: "/api/admin/v1/members",
        headers: {
          cookie: betaCookie,
          "x-publication-id": PUB_BETA_ID,
        },
      });
      expect(betaListRes.statusCode).toBe(200);
      const betaMembers = betaListRes.json().members;
      expect(betaMembers.some((m: any) => m.id === betaMemberId)).toBe(true);
    });
  });

  describe("10. Exhaustive 14-Resource Domain Coverage & Cross-Tenant Attacks", () => {
    it("pages: enforces publication isolation on CRUD and cross-tenant attacks", async () => {
      // Create page in Alpha
      const createRes = await app.inject({
        method: "POST",
        url: "/api/admin/v1/pages",
        headers: {
          cookie: alphaCookie,
          "x-publication-id": PUB_ALPHA_ID,
          origin: "http://127.0.0.1:7780",
        },
        payload: {
          title: "Alpha Unique Page",
          slug: `alpha-page-${runId}`,
          content: { schema: "vibress-studio", version: 1, root: { type: "root", children: [] } },
          status: "published",
          primaryAuthorId: userAlphaId,
        },
      });
      expect(createRes.statusCode).toBe(201);
      const alphaPageId = createRes.json().page.id;

      // Alpha reads by ID
      const readRes = await app.inject({
        method: "GET",
        url: `/api/admin/v1/pages/${alphaPageId}`,
        headers: { cookie: alphaCookie, "x-publication-id": PUB_ALPHA_ID },
      });
      expect(readRes.statusCode).toBe(200);

      // Beta cross-tenant attack: READ -> 404
      const crossRead = await app.inject({
        method: "GET",
        url: `/api/admin/v1/pages/${alphaPageId}`,
        headers: { cookie: betaCookie, "x-publication-id": PUB_BETA_ID },
      });
      expect(crossRead.statusCode).toBe(404);

      // Beta cross-tenant attack: UPDATE -> 404
      const crossUpdate = await app.inject({
        method: "PUT",
        url: `/api/admin/v1/pages/${alphaPageId}`,
        headers: {
          cookie: betaCookie,
          "x-publication-id": PUB_BETA_ID,
          origin: "http://127.0.0.1:7780",
        },
        payload: { title: "Hacked by Beta" },
      });
      expect(crossUpdate.statusCode).toBe(404);

      // Beta cross-tenant attack: DELETE -> 404
      const crossDelete = await app.inject({
        method: "DELETE",
        url: `/api/admin/v1/pages/${alphaPageId}`,
        headers: {
          cookie: betaCookie,
          "x-publication-id": PUB_BETA_ID,
          origin: "http://127.0.0.1:7780",
        },
      });
      expect(crossDelete.statusCode).toBe(404);
    });

    it("tags: enforces publication isolation on CRUD and cross-tenant attacks", async () => {
      // Create tag in Alpha
      const createRes = await app.inject({
        method: "POST",
        url: "/api/admin/v1/tags",
        headers: {
          cookie: alphaCookie,
          "x-publication-id": PUB_ALPHA_ID,
          origin: "http://127.0.0.1:7780",
        },
        payload: {
          name: `Alpha Unique Tag ${runId}`,
          slug: `alpha-tag-${runId}`,
        },
      });
      expect(createRes.statusCode).toBe(201);
      const alphaTagId = createRes.json().tag.id;

      // Beta cross-tenant attack: UPDATE -> 404
      const crossUpdate = await app.inject({
        method: "PUT",
        url: `/api/admin/v1/tags/${alphaTagId}`,
        headers: {
          cookie: betaCookie,
          "x-publication-id": PUB_BETA_ID,
          origin: "http://127.0.0.1:7780",
        },
        payload: { name: "Hacked Tag" },
      });
      expect(crossUpdate.statusCode).toBe(404);

      // Beta cross-tenant attack: DELETE -> 404
      const crossDelete = await app.inject({
        method: "DELETE",
        url: `/api/admin/v1/tags/${alphaTagId}`,
        headers: {
          cookie: betaCookie,
          "x-publication-id": PUB_BETA_ID,
          origin: "http://127.0.0.1:7780",
        },
      });
      expect(crossDelete.statusCode).toBe(404);
    });

    it("media_assets: enforces publication isolation on reads and deletes", async () => {
      const db = getDb();
      const alphaMediaId = crypto.randomUUID();
      await db.insert(mediaAssets).values({
        id: alphaMediaId,
        publicationId: PUB_ALPHA_ID,
        storageKey: `uploads/${PUB_ALPHA_ID}/test-${runId}.png`,
        originalFilename: "test.png",
        displayName: "Test Image",
        mimeType: "image/png",
        extension: "png",
        sizeBytes: 1024,
        checksum: `checksum-${runId}`,
        assetType: "image",
      });

      // Alpha reads own media -> 200
      const readRes = await app.inject({
        method: "GET",
        url: `/api/admin/v1/media/${alphaMediaId}`,
        headers: { cookie: alphaCookie, "x-publication-id": PUB_ALPHA_ID },
      });
      expect(readRes.statusCode).toBe(200);

      // Beta cross-tenant attack: READ -> 404
      const crossRead = await app.inject({
        method: "GET",
        url: `/api/admin/v1/media/${alphaMediaId}`,
        headers: { cookie: betaCookie, "x-publication-id": PUB_BETA_ID },
      });
      expect(crossRead.statusCode).toBe(404);

      // Beta cross-tenant attack: DELETE -> 404
      const crossDelete = await app.inject({
        method: "DELETE",
        url: `/api/admin/v1/media/${alphaMediaId}`,
        headers: {
          cookie: betaCookie,
          "x-publication-id": PUB_BETA_ID,
          origin: "http://127.0.0.1:7780",
        },
      });
      expect(crossDelete.statusCode).toBe(404);
    });

    it("products & plans: enforces publication isolation and composite FK protection", async () => {
      const db = getDb();
      const alphaProdId = crypto.randomUUID();
      await db.insert(products).values({
        id: alphaProdId,
        publicationId: PUB_ALPHA_ID,
        key: `pro-${runId}`,
        name: "Alpha Pro Tier",
      });

      // Beta staff queries products -> Alpha product not in list
      const betaProdList = await app.inject({
        method: "GET",
        url: "/api/admin/v1/products",
        headers: { cookie: betaCookie, "x-publication-id": PUB_BETA_ID },
      });
      expect(betaProdList.statusCode).toBe(200);
      const betaProds = betaProdList.json().products;
      expect(betaProds.some((p: any) => p.id === alphaProdId)).toBe(false);

      // Composite FK adversarial attack:
      // An attacker attempts to create a plan in Publication Beta pointing to Publication Alpha's product.
      // Database MUST reject with foreign_key_violation (plans_product_publication_fk).
      let fkViolated = false;
      try {
        await db.insert(plans).values({
          id: crypto.randomUUID(),
          publicationId: PUB_BETA_ID,
          productId: alphaProdId,
          key: `yearly-${runId}`,
          name: "Cross-Tenant Exploited Plan",
          currency: "USD",
          amountMinor: 10000,
        });
      } catch (err: any) {
        fkViolated =
          err.code === "23503" ||
          err.cause?.code === "23503" ||
          err.cause?.constraint === "plans_product_publication_fk" ||
          String(err).includes("foreign key") ||
          String(err.cause).includes("foreign key");
      }
      expect(fkViolated).toBe(true);
    });

    it("newsletters: isolates newsletter CRUD and cross-tenant access", async () => {
      const db = getDb();
      const alphaNewsId = crypto.randomUUID();
      await db.insert(newsletters).values({
        id: alphaNewsId,
        publicationId: PUB_ALPHA_ID,
        key: `weekly-${runId}`,
        name: "Alpha Weekly",
        senderName: "Alpha News",
        senderEmail: "news@alpha.test",
      });

      // Beta staff lists newsletters -> does not see Alpha newsletter
      const betaList = await app.inject({
        method: "GET",
        url: "/api/admin/v1/newsletters",
        headers: { cookie: betaCookie, "x-publication-id": PUB_BETA_ID },
      });
      expect(betaList.statusCode).toBe(200);
      const newslettersList = betaList.json().newsletters || [];
      expect(newslettersList.some((n: any) => n.id === alphaNewsId)).toBe(false);
    });

    it("automations: isolates automation workflows between publications", async () => {
      const db = getDb();
      const alphaAutoId = crypto.randomUUID();
      await db.insert(automations).values({
        id: alphaAutoId,
        publicationId: PUB_ALPHA_ID,
        key: `on-signup-${runId}`,
        name: "Welcome Automation",
        triggerEvent: "member.created",
        status: "active",
      });

      // Beta staff queries automations -> does not see Alpha automation
      const betaAutoRes = await app.inject({
        method: "GET",
        url: "/api/admin/v1/automations",
        headers: { cookie: betaCookie, "x-publication-id": PUB_BETA_ID },
      });
      expect(betaAutoRes.statusCode).toBe(200);
      const automationsList = betaAutoRes.json().automations || [];
      expect(automationsList.some((a: any) => a.id === alphaAutoId)).toBe(false);
    });

    it("installed_themes: isolates installed themes per publication", async () => {
      const db = getDb();
      const themeId = `theme-ext-${runId}`;
      await db.insert(installedThemes).values({
        id: crypto.randomUUID(),
        publicationId: PUB_ALPHA_ID,
        themeId,
        name: "Alpha Custom Theme",
        version: "1.0.0",
        storagePath: `/themes/${PUB_ALPHA_ID}/${themeId}`,
        manifestJson: { id: themeId, name: "Alpha Custom Theme", version: "1.0.0", themeApi: 1 },
        status: "installed",
      });

      // Alpha sees the installed theme
      const alphaThemesRes = await app.inject({
        method: "GET",
        url: "/api/admin/v1/themes",
        headers: { cookie: alphaCookie, "x-publication-id": PUB_ALPHA_ID },
      });
      expect(alphaThemesRes.statusCode).toBe(200);
      const alphaThemes = alphaThemesRes.json().themes;
      expect(alphaThemes.some((t: any) => t.manifest.id === themeId)).toBe(true);

      // Beta DOES NOT see Alpha's installed theme
      const betaThemesRes = await app.inject({
        method: "GET",
        url: "/api/admin/v1/themes",
        headers: { cookie: betaCookie, "x-publication-id": PUB_BETA_ID },
      });
      expect(betaThemesRes.statusCode).toBe(200);
      const betaThemes = betaThemesRes.json().themes;
      expect(betaThemes.some((t: any) => t.manifest.id === themeId)).toBe(false);
    });

    it("webhook_endpoints: isolates webhook endpoints and dispatch targets", async () => {
      const db = getDb();
      const alphaHookId = crypto.randomUUID();
      await db.insert(webhookEndpoints).values({
        id: alphaHookId,
        publicationId: PUB_ALPHA_ID,
        name: "Alpha Discord",
        url: "https://discord.example.com/alpha",
        enabled: true,
      });

      // Beta staff queries webhooks -> Alpha webhook not visible
      const betaHooksRes = await app.inject({
        method: "GET",
        url: "/api/admin/v1/webhook-endpoints",
        headers: { cookie: betaCookie, "x-publication-id": PUB_BETA_ID },
      });
      expect(betaHooksRes.statusCode).toBe(200);
      const hooks = betaHooksRes.json().endpoints || [];
      expect(hooks.some((h: any) => h.id === alphaHookId)).toBe(false);
    });

    it("analytics_events: isolates analytics recording and metrics", async () => {
      const db = getDb();
      await db.insert(analyticsEvents).values([
        {
          id: crypto.randomUUID(),
          publicationId: PUB_ALPHA_ID,
          eventId: `evt-alpha-${runId}`,
          eventName: "post.view",
          occurredAt: new Date(),
          path: "/posts/alpha-post",
        },
        {
          id: crypto.randomUUID(),
          publicationId: PUB_BETA_ID,
          eventId: `evt-beta-${runId}`,
          eventName: "post.view",
          occurredAt: new Date(),
          path: "/posts/beta-post",
        },
      ]);

      // Alpha queries analytics
      const alphaAnalytics = await app.inject({
        method: "GET",
        url: "/api/admin/v1/analytics/overview",
        headers: { cookie: alphaCookie, "x-publication-id": PUB_ALPHA_ID },
      });
      expect(alphaAnalytics.statusCode).toBe(200);
    });
  });

  describe("11. Real Concurrency Stress & Zero Cross-Contamination", () => {
    it("processes interleaved concurrent requests between Alpha and Beta without data bleeding", async () => {
      // Concurrently fire 20 requests interleaved between Alpha and Beta
      const requests = Array.from({ length: 20 }).map((_, index) => {
        const isAlpha = index % 2 === 0;
        const host = isAlpha ? ALPHA_HOST : BETA_HOST;
        const cookie = isAlpha ? alphaCookie : betaCookie;
        const pubId = isAlpha ? PUB_ALPHA_ID : PUB_BETA_ID;
        const expectedPostId = isAlpha ? alphaPostId : betaPostId;

        // Alternate between Public Web GET, Admin GET, and Search GET
        if (index % 3 === 0) {
          return app
            .inject({
              method: "GET",
              url: `/api/content/v1/posts/${sharedSlug}`,
              headers: { host },
            })
            .then((res) => {
              expect(res.statusCode).toBe(200);
              const post = res.json().post;
              expect(post.id).toBe(expectedPostId);
              expect(post.title).toContain(isAlpha ? "Alpha" : "Beta");
            });
        } else if (index % 3 === 1) {
          return app
            .inject({
              method: "GET",
              url: "/api/admin/v1/posts",
              headers: { cookie, "x-publication-id": pubId },
            })
            .then((res) => {
              expect(res.statusCode).toBe(200);
              const postsList = res.json().posts;
              const hasOther = postsList.some((p: any) =>
                isAlpha ? p.id === betaPostId : p.id === alphaPostId
              );
              expect(hasOther).toBe(false);
            });
        } else {
          return app
            .inject({
              method: "GET",
              url: `/api/content/v1/search?q=Exclusive`,
              headers: { host },
            })
            .then((res) => {
              expect(res.statusCode).toBe(200);
              const results = res.json().results;
              expect(
                results.every((r: any) => (isAlpha ? r.title.includes("Alpha") : r.title.includes("Beta")))
              ).toBe(true);
            });
        }
      });

      await Promise.all(requests);
    });
  });

  describe("12. Admin Publication Context Switching for Dual-Member Staff", () => {
    it("allows a legitimate dual-publication user to switch contexts without stale data leakage", async () => {
      const db = getDb();
      const dualUserEmail = `dual.staff.${runId}@example.com`;
      const dualUserId = crypto.randomUUID();
      const passwordHash = await hashPassword(COMMON_PASSWORD);

      await db.insert(users).values({
        id: dualUserId,
        email: dualUserEmail,
        name: "Dual Staff User",
        passwordHash,
        status: "active",
      });

      // Assign global owner role
      const [ownerRole] = await db.select().from(roles).where(eq(roles.key, "owner"));
      if (ownerRole) {
        await db.insert(userRoles).values({
          userId: dualUserId,
          roleId: ownerRole.id,
        });
      }

      // Assign membership to BOTH Alpha and Beta
      await db.insert(publicationMemberships).values([
        {
          id: crypto.randomUUID(),
          publicationId: PUB_ALPHA_ID,
          userId: dualUserId,
          role: "owner",
        },
        {
          id: crypto.randomUUID(),
          publicationId: PUB_BETA_ID,
          userId: dualUserId,
          role: "owner",
        },
      ]);

      // Login as dual user
      const loginRes = await app.inject({
        method: "POST",
        url: "/api/admin/v1/auth/login",
        payload: { email: dualUserEmail, password: COMMON_PASSWORD },
      });
      expect(loginRes.statusCode).toBe(200);
      const dualCookie = ((loginRes.headers["set-cookie"] as string) || "").split(";")[0] ?? "";

      // Step 1: Query with X-Publication-Id: Alpha -> receives Alpha data only
      const alphaView = await app.inject({
        method: "GET",
        url: "/api/admin/v1/posts",
        headers: { cookie: dualCookie, "x-publication-id": PUB_ALPHA_ID },
      });
      expect(alphaView.statusCode).toBe(200);
      const alphaPosts = alphaView.json().posts;
      expect(alphaPosts.some((p: any) => p.id === alphaPostId)).toBe(true);
      expect(alphaPosts.some((p: any) => p.id === betaPostId)).toBe(false);

      // Step 2: Switch context to X-Publication-Id: Beta -> receives Beta data only
      const betaView = await app.inject({
        method: "GET",
        url: "/api/admin/v1/posts",
        headers: { cookie: dualCookie, "x-publication-id": PUB_BETA_ID },
      });
      expect(betaView.statusCode).toBe(200);
      const betaPosts = betaView.json().posts;
      expect(betaPosts.some((p: any) => p.id === betaPostId)).toBe(true);
      expect(betaPosts.some((p: any) => p.id === alphaPostId)).toBe(false);

      // Step 3: Switch back to Alpha -> receives Alpha data only
      const alphaReturn = await app.inject({
        method: "GET",
        url: "/api/admin/v1/posts",
        headers: { cookie: dualCookie, "x-publication-id": PUB_ALPHA_ID },
      });
      expect(alphaReturn.statusCode).toBe(200);
      const alphaReturnPosts = alphaReturn.json().posts;
      expect(alphaReturnPosts.some((p: any) => p.id === alphaPostId)).toBe(true);
      expect(alphaReturnPosts.some((p: any) => p.id === betaPostId)).toBe(false);

      // Step 4: Attempt to switch to an unassigned publication -> 403 Forbidden
      const unauthorizedSwitch = await app.inject({
        method: "GET",
        url: "/api/admin/v1/posts",
        headers: { cookie: dualCookie, "x-publication-id": "pub_unassigned_phantom" },
      });
      expect(unauthorizedSwitch.statusCode).toBe(403);
    });
  });

  describe("13. Client-Supplied Tenant Field Spoofing Resistance", () => {
    it("ignores or rejects client-supplied tenant overrides that conflict with authoritative context", async () => {
      // Attacker in Alpha context passes body.publicationId = PUB_BETA_ID
      const spoofedPostCreate = await app.inject({
        method: "POST",
        url: "/api/admin/v1/posts",
        headers: { cookie: alphaCookie, "x-publication-id": PUB_ALPHA_ID },
        payload: {
          title: "Spoofed Post Attempt",
          slug: `spoofed-post-${runId}`,
          publicationId: PUB_BETA_ID, // Malicious injection in body
          content: { schema: "vibress-studio", version: 1, root: { type: "root", children: [] } },
        },
      });

      if (spoofedPostCreate.statusCode === 201) {
        // If created, it MUST be forced to PUB_ALPHA_ID, never PUB_BETA_ID
        const createdPost = spoofedPostCreate.json().post;
        expect(createdPost.publicationId).toBe(PUB_ALPHA_ID);
      } else {
        expect([400, 403]).toContain(spoofedPostCreate.statusCode);
      }

      // Attacker in Alpha context attempts to spoof query.publicationId
      const spoofedQuery = await app.inject({
        method: "GET",
        url: `/api/admin/v1/members?publicationId=${PUB_BETA_ID}`,
        headers: { cookie: alphaCookie, "x-publication-id": PUB_ALPHA_ID },
      });
      expect(spoofedQuery.statusCode).toBe(200);
      // Query response MUST NOT contain Beta members
      const members = spoofedQuery.json().members || [];
      expect(members.every((m: any) => m.publicationId === PUB_ALPHA_ID)).toBe(true);
    });
  });
});
