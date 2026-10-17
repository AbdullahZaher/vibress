import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import {
  getDb,
  publications,
  publicationMemberships,
  publicationLocales,
  posts,
  users,
  contentTranslations,
  searchDocuments,
  eq,
  and,
  inArray,
  notInArray,
} from "@vibress/database";
import { DrizzleSearchRepository, SearchService } from "@vibress/search";
import { WorkerSearchContentSource } from "../../apps/worker/src/processors/search-content-source";

describe("LOC-005: Localized Search Architecture & Multi-Locale Indexing", () => {
  let searchRepo: DrizzleSearchRepository;
  let searchService: SearchService;
  let authorId = "usr_default";
  const testPubId = "pub_localized_search_test";

  beforeAll(async () => {
    const db = getDb();
    const [existingUser] = await db.select().from(users).limit(1);
    if (existingUser) {
      authorId = existingUser.id;
    }

    await db
      .insert(publications)
      .values({
        id: testPubId,
        workspaceId: "ws_default",
        name: "Search Test Pub",
        slug: "search-test-pub",
        primaryLocale: "en",
      })
      .onConflictDoNothing();

    await db
      .insert(publicationMemberships)
      .values({
        id: "pm_test_search",
        publicationId: testPubId,
        userId: authorId,
        role: "owner",
      })
      .onConflictDoNothing();
  });

  beforeEach(async () => {
    const db = getDb();
    await db
      .delete(searchDocuments)
      .where(eq(searchDocuments.publicationId, testPubId));
    await db
      .delete(contentTranslations)
      .where(eq(contentTranslations.publicationId, testPubId));
    await db
      .delete(posts)
      .where(eq(posts.publicationId, testPubId));

    searchRepo = new DrizzleSearchRepository();
    searchService = new SearchService(searchRepo);
  });

  it("indexes and discovers published translations in their target language (LOC-005)", async () => {
    const db = getDb();
    const postId = "post_ai_future";

    // 1. Create primary English post
    await db.insert(posts).values({
      id: postId,
      publicationId: testPubId,
      title: "The Future of AI Architecture",
      slug: "future-of-ai",
      primaryAuthorId: authorId,
      createdBy: authorId,
      updatedBy: authorId,
      content: {
        schema: "vibress-studio",
        version: 1,
        root: {
          type: "root",
          children: [
            {
              type: "paragraph",
              children: [{ type: "text", text: "Modern deep neural network models." }],
            },
          ],
        },
      },
      status: "published",
      visibility: "public",
      publishedAt: new Date(),
    });

    // 2. Index primary English post
    await searchService.indexDocument({
      entityType: "post",
      entityId: postId,
      locale: "en",
      title: "The Future of AI Architecture",
      bodyText: "Modern deep neural network models.",
      slug: "future-of-ai",
      url: `/posts/future-of-ai`,
      publicationId: testPubId,
    });

    // 3. Create and index published Arabic translation
    await db.insert(contentTranslations).values({
      id: "tr_ai_future_ar",
      publicationId: testPubId,
      contentType: "post",
      contentId: postId,
      sourceLocale: "en",
      targetLocale: "ar",
      title: "مستقبل بنية الذكاء الاصطناعي",
      slug: "future-of-ai-ar",
      content: {
        schema: "vibress-studio",
        version: 1,
        root: {
          type: "root",
          children: [
            {
              type: "paragraph",
              children: [{ type: "text", text: "نماذج الشبكات العصبية العميقة الحديثة." }],
            },
          ],
        },
      },
      status: "published",
    });

    await searchService.indexDocument({
      entityType: "post",
      entityId: postId,
      locale: "ar",
      title: "مستقبل بنية الذكاء الاصطناعي",
      bodyText: "نماذج الشبكات العصبية العميقة الحديثة.",
      slug: "future-of-ai-ar",
      url: `/ar/posts/future-of-ai-ar`,
      publicationId: testPubId,
    });

    // 4. Create and index published French translation
    await db.insert(contentTranslations).values({
      id: "tr_ai_future_fr",
      publicationId: testPubId,
      contentType: "post",
      contentId: postId,
      sourceLocale: "en",
      targetLocale: "fr",
      title: "L'Avenir de l'Architecture de l'IA",
      slug: "future-of-ai-fr",
      content: {
        schema: "vibress-studio",
        version: 1,
        root: {
          type: "root",
          children: [
            {
              type: "paragraph",
              children: [{ type: "text", text: "Modèles modernes de réseaux de neurones profonds." }],
            },
          ],
        },
      },
      status: "published",
    });

    await searchService.indexDocument({
      entityType: "post",
      entityId: postId,
      locale: "fr",
      title: "L'Avenir de l'Architecture de l'IA",
      bodyText: "Modèles modernes de réseaux de neurones profonds.",
      slug: "future-of-ai-fr",
      url: `/fr/posts/future-of-ai-fr`,
      publicationId: testPubId,
    });

    // Verify Arabic search
    const arRes = await searchService.search("الذكاء", 10, 0, testPubId, "ar");
    expect(arRes.total).toBe(1);
    expect(arRes.results[0]?.title).toBe("مستقبل بنيه الذكاء الاصطناعي");
    expect(arRes.results[0]?.url).toBe("/ar/posts/future-of-ai-ar");
    expect(arRes.results[0]?.locale).toBe("ar");

    // Verify French search
    const frRes = await searchService.search("Avenir", 10, 0, testPubId, "fr");
    expect(frRes.total).toBe(1);
    expect(frRes.results[0]?.title).toBe("L'Avenir de l'Architecture de l'IA");
    expect(frRes.results[0]?.url).toBe("/fr/posts/future-of-ai-fr");
    expect(frRes.results[0]?.locale).toBe("fr");

    // Verify English search
    const enRes = await searchService.search("Architecture", 10, 0, testPubId, "en");
    expect(enRes.total).toBe(1);
    expect(enRes.results[0]?.title).toBe("The Future of AI Architecture");
    expect(enRes.results[0]?.url).toBe("/posts/future-of-ai");
    expect(enRes.results[0]?.locale).toBe("en");

    // Verify cross-locale isolation: French query in Arabic locale returns zero
    const crossRes = await searchService.search("Avenir", 10, 0, testPubId, "ar");
    expect(crossRes.total).toBe(0);
  });

  it("proves draft translations are never indexed by content rebuild source", async () => {
    const db = getDb();
    const postId = "post_draft_translation";

    await db.insert(posts).values({
      id: postId,
      publicationId: testPubId,
      title: "Confidential Strategy",
      slug: "confidential-strategy",
      primaryAuthorId: authorId,
      createdBy: authorId,
      updatedBy: authorId,
      content: {
        schema: "vibress-studio",
        version: 1,
        root: { type: "root", children: [] },
      },
      status: "published",
      visibility: "public",
      publishedAt: new Date(),
    });

    // Draft translation in Arabic (status = 'draft')
    await db.insert(contentTranslations).values({
      id: "tr_draft_ar",
      publicationId: testPubId,
      contentType: "post",
      contentId: postId,
      sourceLocale: "en",
      targetLocale: "ar",
      title: "استراتيجية سرية مسودة",
      slug: "confidential-strategy-ar",
      content: {
        schema: "vibress-studio",
        version: 1,
        root: { type: "root", children: [] },
      },
      status: "draft",
    });

    const contentSource = new WorkerSearchContentSource();
    const indexable = await contentSource.listIndexableContent(testPubId);

    // Only English post should be listed, NOT the draft Arabic translation
    const arDocs = indexable.filter((d) => d.locale === "ar");
    expect(arDocs.length).toBe(0);

    const enDocs = indexable.filter((d) => d.entityId === postId && d.locale === "en");
    expect(enDocs.length).toBe(1);
  });

  it("removes localized search documents when unpublishing or deleting translations", async () => {
    const postId = "post_to_remove";

    await searchService.indexDocument({
      entityType: "post",
      entityId: postId,
      locale: "en",
      title: "English Version",
      bodyText: "Text",
      publicationId: testPubId,
    });

    await searchService.indexDocument({
      entityType: "post",
      entityId: postId,
      locale: "ar",
      title: "النسخة العربية",
      bodyText: "نص",
      publicationId: testPubId,
    });

    // Remove only Arabic translation
    await searchService.removeDocument("post", postId, testPubId, "ar");

    const arAfter = await searchService.search("العربية", 10, 0, testPubId, "ar");
    expect(arAfter.total).toBe(0);

    const enAfter = await searchService.search("English", 10, 0, testPubId, "en");
    expect(enAfter.total).toBe(1);

    // Now remove entity completely (all locales dropped)
    await searchService.removeDocument("post", postId, testPubId);

    const enFinal = await searchService.search("English", 10, 0, testPubId, "en");
    expect(enFinal.total).toBe(0);
  });

  it("indexes and rebuilds Arabic-first publication source posts with locale 'ar'", async () => {
    const db = getDb();
    const arabicPubId = "pub_arabic_first_" + Date.now();
    const arabicPostId = "post_ar_first_" + Date.now();

    await db.insert(publications).values({
      id: arabicPubId,
      workspaceId: "ws_default",
      name: "منشور عربي أولاً",
      slug: "arabic-first-" + Date.now(),
      primaryLocale: "ar",
    });

    await db.insert(publicationMemberships).values({
      id: "pm_ar_" + Date.now(),
      publicationId: arabicPubId,
      userId: authorId,
      role: "owner",
    });

    await db.insert(posts).values({
      id: arabicPostId,
      publicationId: arabicPubId,
      title: "التطوير الهندسي للنظم السحابية",
      slug: "cloud-engineering-ar",
      primaryAuthorId: authorId,
      createdBy: authorId,
      updatedBy: authorId,
      content: {
        schema: "vibress-studio",
        version: 1,
        root: {
          type: "root",
          children: [
            {
              type: "paragraph",
              children: [{ type: "text", text: "بناء أنظمة برمجية قابلة للتوسع." }],
            },
          ],
        },
      },
      status: "published",
      visibility: "public",
      publishedAt: new Date(),
    });

    const contentSource = new WorkerSearchContentSource();
    const indexable = await contentSource.listIndexableContent(arabicPubId);

    const postDoc = indexable.find((d) => d.entityId === arabicPostId);
    expect(postDoc).toBeDefined();
    // Must be indexed with Arabic locale, NOT hardcoded "en"
    expect(postDoc?.locale).toBe("ar");
    expect(postDoc?.url).toContain(`/posts/cloud-engineering-ar`);

    // Perform full rebuild on the Arabic publication
    const indexedCount = await searchService.rebuild(contentSource, arabicPubId);
    expect(indexedCount).toBeGreaterThanOrEqual(1);

    // Search with Arabic query in Arabic locale
    const searchAr = await searchService.search("الهندسي", 10, 0, arabicPubId, "ar");
    expect(searchAr.total).toBe(1);
    expect(searchAr.results[0]?.locale).toBe("ar");
    expect(searchAr.results[0]?.url).toContain(`/posts/cloud-engineering-ar`);

    // Search with English locale should yield 0 results
    const searchEn = await searchService.search("الهندسي", 10, 0, arabicPubId, "en");
    expect(searchEn.total).toBe(0);

    // Clean up
    await db.delete(searchDocuments).where(eq(searchDocuments.publicationId, arabicPubId));
    await db.delete(posts).where(eq(posts.publicationId, arabicPubId));
    await db.delete(publicationMemberships).where(eq(publicationMemberships.publicationId, arabicPubId));
    await db.delete(publications).where(eq(publications.id, arabicPubId));
  });

  it("enforces cross-publication tenant isolation in search queries", async () => {
    const db = getDb();
    const pubA = "pub_tenant_a_" + Date.now();
    const pubB = "pub_tenant_b_" + Date.now();

    await db.insert(publications).values([
      { id: pubA, workspaceId: "ws_default", name: "Tenant A", slug: "tenant-a-" + Date.now(), primaryLocale: "en" },
      { id: pubB, workspaceId: "ws_default", name: "Tenant B", slug: "tenant-b-" + Date.now(), primaryLocale: "en" },
    ]);

    await searchService.indexDocument({
      entityType: "post",
      entityId: "post_tenant_a",
      locale: "en",
      title: "Shared Security Topic in Tenant A",
      bodyText: "Confidential Tenant A data",
      slug: "security-tenant-a",
      publicationId: pubA,
    });

    await searchService.indexDocument({
      entityType: "post",
      entityId: "post_tenant_b",
      locale: "en",
      title: "Shared Security Topic in Tenant B",
      bodyText: "Confidential Tenant B data",
      slug: "security-tenant-b",
      publicationId: pubB,
    });

    // Query on pubA must only return Tenant A's document
    const resA = await searchService.search("Shared Security Topic", 10, 0, pubA, "en");
    expect(resA.total).toBe(1);
    expect(resA.results[0]?.entityId).toBe("post_tenant_a");

    // Query on pubB must only return Tenant B's document
    const resB = await searchService.search("Shared Security Topic", 10, 0, pubB, "en");
    expect(resB.total).toBe(1);
    expect(resB.results[0]?.entityId).toBe("post_tenant_b");

    // Clean up
    await db.delete(searchDocuments).where(inArray(searchDocuments.publicationId, [pubA, pubB]));
    await db.delete(publications).where(inArray(publications.id, [pubA, pubB]));
  });

  it("strictly excludes disabled locale documents from search results even if present in index", async () => {
    const disabledPubId = "pub_disabled_locale_" + Date.now();
    const db = getDb();

    await db.insert(publications).values({
      id: disabledPubId,
      workspaceId: "ws_default",
      name: "Disabled Locale Pub",
      slug: "disabled-locale-pub-" + Date.now(),
      primaryLocale: "en",
    });

    // Seed search index with an English document, an Arabic document, and a stale Spanish document
    await searchService.indexDocument({
      entityType: "post",
      entityId: "p_en",
      locale: "en",
      title: "Global Architecture Overview",
      bodyText: "Core microservice and database patterns",
      publicationId: disabledPubId,
    });
    await searchService.indexDocument({
      entityType: "post",
      entityId: "p_ar",
      locale: "ar",
      title: "نظرة عامة على البنية البرمجية",
      bodyText: "أنماط قواعد البيانات",
      publicationId: disabledPubId,
    });
    await searchService.indexDocument({
      entityType: "post",
      entityId: "p_es",
      locale: "es", // Disabled language!
      title: "Arquitectura Global",
      bodyText: "Patrones de bases de datos",
      publicationId: disabledPubId,
    });

    // 1. Search without locale but with allowedLocales = ['en', 'ar']
    // Must return the English and Arabic matches, but strictly exclude 'es'
    const openRes = await searchService.search("Architecture", 10, 0, disabledPubId, undefined, ["en", "ar"]);
    expect(openRes.total).toBe(1);
    expect(openRes.results[0]?.locale).toBe("en");

    // 2. Client queries directly for disabled 'es' locale with allowedLocales = ['en', 'ar']
    const esRes = await searchService.search("Arquitectura", 10, 0, disabledPubId, "es", ["en", "ar"]);
    expect(esRes.total).toBe(0);

    // Clean up
    await db.delete(searchDocuments).where(eq(searchDocuments.publicationId, disabledPubId));
    await db.delete(publications).where(eq(publications.id, disabledPubId));
  });

  it("rebuild content source ignores translations whose locale is not enabled", async () => {
    const db = getDb();
    const pubId = "pub_filter_trans_" + Date.now();
    const postId = "post_trans_filter_" + Date.now();

    await db.insert(publications).values({
      id: pubId,
      workspaceId: "ws_default",
      name: "Translation Filter Pub",
      slug: "trans-filter-" + Date.now(),
      primaryLocale: "en",
    });

    // Enable 'en' and 'ar' in publicationLocales, leaving 'es' disabled/unregistered
    await db.insert(publicationLocales).values([
      {
        id: "pl_en_" + Date.now(),
        publicationId: pubId,
        locale: "en",
        status: "active",
        isDefault: true,
      },
      {
        id: "pl_ar_" + Date.now(),
        publicationId: pubId,
        locale: "ar",
        status: "active",
        isDefault: false,
      },
      {
        id: "pl_es_" + Date.now(),
        publicationId: pubId,
        locale: "es",
        status: "disabled",
        isDefault: false,
      },
    ]);

    await db.insert(publicationMemberships).values({
      id: "pm_trans_filter_" + Date.now(),
      publicationId: pubId,
      userId: authorId,
      role: "owner",
    });

    await db.insert(posts).values({
      id: postId,
      publicationId: pubId,
      title: "Core System Design",
      slug: "system-design",
      primaryAuthorId: authorId,
      createdBy: authorId,
      updatedBy: authorId,
      content: { schema: "vibress-studio", version: 1, root: { type: "root", children: [] } },
      status: "published",
      visibility: "public",
      publishedAt: new Date(),
    });

    // Arabic translation (active locale)
    await db.insert(contentTranslations).values({
      id: "tr_ar_" + Date.now(),
      publicationId: pubId,
      contentType: "post",
      contentId: postId,
      sourceLocale: "en",
      targetLocale: "ar",
      title: "تصميم النظام الأساسي",
      slug: "system-design-ar",
      content: { schema: "vibress-studio", version: 1, root: { type: "root", children: [] } },
      status: "published",
    });

    // Spanish translation (disabled locale)
    await db.insert(contentTranslations).values({
      id: "tr_es_" + Date.now(),
      publicationId: pubId,
      contentType: "post",
      contentId: postId,
      sourceLocale: "en",
      targetLocale: "es",
      title: "Diseño del Sistema Central",
      slug: "system-design-es",
      content: { schema: "vibress-studio", version: 1, root: { type: "root", children: [] } },
      status: "published",
    });

    const contentSource = new WorkerSearchContentSource();
    const indexable = await contentSource.listIndexableContent(pubId);

    const locales = indexable.map((d) => d.locale);
    expect(locales).toContain("en");
    expect(locales).toContain("ar");
    // 'es' must be omitted because it is disabled
    expect(locales).not.toContain("es");

    // Clean up
    await db.delete(contentTranslations).where(eq(contentTranslations.publicationId, pubId));
    await db.delete(posts).where(eq(posts.publicationId, pubId));
    await db.delete(publicationMemberships).where(eq(publicationMemberships.publicationId, pubId));
    await db.delete(publicationLocales).where(eq(publicationLocales.publicationId, pubId));
    await db.delete(publications).where(eq(publications.id, pubId));
  });

  it("purges stale search documents when locales are disabled in publication settings", async () => {
    const db = getDb();
    const pubId = "pub_purge_" + Date.now();

    await db.insert(publications).values({
      id: pubId,
      workspaceId: "ws_default",
      name: "Purge Test Pub",
      slug: "purge-pub-" + Date.now(),
      primaryLocale: "en",
    });

    // Seed search documents for en, ar, and es
    await db.insert(searchDocuments).values([
      {
        id: "sd_en_" + Date.now(),
        publicationId: pubId,
        entityType: "post",
        entityId: "p1",
        locale: "en",
        title: "English Post",
        bodyText: "Text",
        slug: "post-en",
        url: "/posts/post-en",
        searchVector: "",
      },
      {
        id: "sd_ar_" + Date.now(),
        publicationId: pubId,
        entityType: "post",
        entityId: "p1",
        locale: "ar",
        title: "منشور عربي",
        bodyText: "نص",
        slug: "post-ar",
        url: "/ar/posts/post-ar",
        searchVector: "",
      },
      {
        id: "sd_es_" + Date.now(),
        publicationId: pubId,
        entityType: "post",
        entityId: "p1",
        locale: "es", // Now disabled
        title: "Publicación en Español",
        bodyText: "Texto",
        slug: "post-es",
        url: "/es/posts/post-es",
        searchVector: "",
      },
    ]);

    // Active enabled locales after update: ['en', 'ar']
    const enabledLocales = ["en", "ar"];
    await db
      .delete(searchDocuments)
      .where(
        and(
          eq(searchDocuments.publicationId, pubId),
          notInArray(searchDocuments.locale, enabledLocales),
        ),
      );

    const remaining = await db
      .select({ locale: searchDocuments.locale })
      .from(searchDocuments)
      .where(eq(searchDocuments.publicationId, pubId));

    const remainingLocales = remaining.map((r) => r.locale);
    expect(remainingLocales).toContain("en");
    expect(remainingLocales).toContain("ar");
    expect(remainingLocales).not.toContain("es");

    // Clean up
    await db.delete(searchDocuments).where(eq(searchDocuments.publicationId, pubId));
    await db.delete(publications).where(eq(publications.id, pubId));
  });

  it("fails closed when publication locale configuration cannot be resolved", async () => {
    const pubId = "pub_fail_closed_" + Date.now();
    const contentSource = new WorkerSearchContentSource();

    // Mock localeService.getConfiguration to throw
    const errorService = {
      getConfiguration: async () => {
        throw new Error("Locale configuration database replica unavailable");
      },
    };
    (contentSource as any).localeService = errorService;

    // Must fail closed and throw, rather than silently defaulting to "en"
    await expect(contentSource.listIndexableContent(pubId)).rejects.toThrow(
      "Locale configuration database replica unavailable",
    );
  });
});
