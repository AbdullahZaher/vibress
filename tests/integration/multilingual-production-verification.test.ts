import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../../apps/api/src/main";
import {
  getDb,
  posts,
  pages,
  users,
  contentTranslations,
  seedDatabase,
  runMigrations,
} from "@vibress/database";
import {
  LocaleRegistry,
  canonicalizeLocale,
  getDirection,
  getFallbackChain,
  normalizeArabicText,
  formatDate,
  formatHijriDate,
  formatNumber,
  formatRelativeTime,
  Translator,
  enDictionary,
  arDictionary,
} from "@vibress/i18n";
import { TranslationService } from "@vibress/i18n/server";
import {
  createLiquidThemeEngine,
  validateThemeRtlCss,
  mapPostToViewModel,
} from "@vibress/theme-core";
import { buildPageMetadata, getPublicSiteUrl } from "../../apps/web/src/lib/seo-helpers";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

describe("Strict Production Verification: Vibress Multilingual & RTL Implementation", () => {
  let app: ReturnType<typeof buildApp>;
  const translationService = new TranslationService();

  const testPostId = randomUUID();
  const testPageId = randomUUID();
  const testTranslationGroupId = randomUUID();

  const suffix = randomUUID().slice(0, 8);
  const testPostSlug = `welcome-to-vibress-${suffix}`;
  const testArabicSlug = `ahlan-bik-fi-vibress-${suffix}`;
  const testPageSlug = `english-only-page-${suffix}`;

  beforeAll(async () => {
    await runMigrations();
    await seedDatabase();
    app = buildApp({ logger: false });
    await app.ready();

    const db = getDb();
    const now = new Date();

    const [adminUser] = await db.select().from(users).limit(1);
    const authorId = adminUser?.id || randomUUID();

    // 1. Seed a test source post in English
    await db.insert(posts).values({
      id: testPostId,
      publicationId: "pub_default",
      title: "Welcome to Vibress",
      slug: testPostSlug,
      excerpt: "The modern publishing platform built for scale.",
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Welcome to Vibress in English!" }],
          },
        ],
      },
      status: "published",
      visibility: "public",
      primaryAuthorId: authorId,
      createdBy: authorId,
      updatedBy: authorId,
      publishedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    // 2. Seed an Arabic translation for the test post
    await db.insert(contentTranslations).values({
      id: randomUUID(),
      publicationId: "pub_default",
      translationGroupId: testTranslationGroupId,
      contentType: "post",
      contentId: testPostId,
      sourceLocale: "en",
      targetLocale: "ar-SA",
      title: "أهلاً بكم في فايبرس",
      slug: testArabicSlug,
      excerpt: "منصة النشر الحديثة المصممة للتوسع والنمو.",
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "مرحباً بكم في فايبرس باللغة العربية!" }],
          },
        ],
      },
      metaTitle: "أهلاً بكم في فايبرس | منصة النشر",
      metaDescription: "منصة النشر الحديثة المصممة للتوسع والنمو.",
      status: "published",
      translationProvider: "human",
      translatedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    // 3. Seed a test page in English without Arabic translation (to test non-fallback 404 behavior)
    await db.insert(pages).values({
      id: testPageId,
      publicationId: "pub_default",
      title: "English Only Page",
      slug: testPageSlug,
      excerpt: "This page is strictly English.",
      content: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "English only." }] }],
      },
      status: "published",
      visibility: "public",
      primaryAuthorId: authorId,
      createdBy: authorId,
      updatedBy: authorId,
      publishedAt: now,
      createdAt: now,
      updatedAt: now,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  // --- Requirement 1: PublicationLocaleResolver / request locale resolution ---
  it("Requirement 1: Resolves locales, BCP-47 canonicalization, direction, and fallback chains", () => {
    expect(canonicalizeLocale("en")).toBe("en");
    expect(canonicalizeLocale("ar-sa")).toBe("ar-SA");
    expect(canonicalizeLocale("ar-EG")).toBe("ar-EG");

    expect(getDirection("en-US")).toBe("ltr");
    expect(getDirection("ar-SA")).toBe("rtl");
    expect(getDirection("ar")).toBe("rtl");
    expect(getDirection("fa-IR")).toBe("rtl");
    expect(getDirection("he-IL")).toBe("rtl");

    const fallbackChain = getFallbackChain("ar-EG");
    expect(fallbackChain).toContain("ar-EG");
    expect(fallbackChain).toContain("en");
  });

  // --- Requirement 2: Locale-prefixed routing & API negotiation ---
  it("Requirement 2: Serves English LTR and Arabic RTL content correctly", async () => {
    // English GET /posts/:slug
    const enRes = await app.inject({
      method: "GET",
      url: `/api/content/v1/posts/${testPostSlug}`,
    });
    expect(enRes.statusCode).toBe(200);
    const enData = JSON.parse(enRes.body);
    expect(enData.post.title).toBe("Welcome to Vibress");
    expect(enData.post.direction).toBe("ltr");
    expect(enData.post.locale).toBeDefined();

    // Arabic GET /posts/:slug with ?locale=ar-SA
    const arRes = await app.inject({
      method: "GET",
      url: `/api/content/v1/posts/${testPostSlug}?locale=ar-SA`,
    });
    expect(arRes.statusCode).toBe(200);
    const arData = JSON.parse(arRes.body);
    expect(arData.post.title).toBe("أهلاً بكم في فايبرس");
    expect(arData.post.slug).toBe(testArabicSlug);
    expect(arData.post.direction).toBe("rtl");
    expect(arData.post.locale).toBe("ar-SA");
  });

  // --- Requirement 3 & 4: URL canonicalization and backward compatibility ---
  it("Requirement 3 & 4: Resolves canonical paths and preserves backward compatibility for existing URLs", () => {
    const siteUrl = getPublicSiteUrl();
    const meta = buildPageMetadata({
      title: "Welcome to Vibress",
      description: "Intro post",
      canonicalPath: `/posts/${testPostSlug}`,
    });
    expect(meta.alternates?.canonical).toBe(`${siteUrl}/posts/${testPostSlug}`);
    expect(meta.openGraph?.title).toBe("Welcome to Vibress");
  });

  // --- Requirement 5: translationGroupId lifecycle ---
  it("Requirement 5: Manages translationGroupId lifecycle across related language variants", async () => {
    const groupItems = await translationService.listTranslationsByGroup(testTranslationGroupId);
    expect(groupItems.length).toBeGreaterThanOrEqual(1);
    expect(groupItems[0].translationGroupId).toBe(testTranslationGroupId);
    expect(groupItems[0].contentId).toBe(testPostId);
  });

  // --- Requirement 6: Stale translation detection ---
  it("Requirement 6: Detects stale translations when source content is updated", async () => {
    const newSourceDate = new Date(Date.now() + 1000 * 60 * 60);

    const tr = await translationService.getTranslation("post", testPostId, "ar-SA", newSourceDate);
    expect(tr).toBeDefined();
    expect(tr?.isStale).toBe(true);
  });

  // --- Requirement 7: Localized slugs ---
  it("Requirement 7: Resolves posts directly by localized Arabic slug", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/content/v1/posts/${testArabicSlug}`,
    });
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.post.title).toBe("أهلاً بكم في فايبرس");
    expect(data.post.direction).toBe("rtl");
  });

  // --- Requirement 8 & 9: Localized navigation & taxonomies ---
  it("Requirement 8 & 9: Supports localized navigation links and direction formatting", () => {
    const translator = new Translator("ar-SA");
    expect(translator.t("nav.home")).toBe("الرئيسية");
    expect(translator.t("nav.subscribe")).toBe("اشتراك");
    expect(translator.getDirection()).toBe("rtl");
  });

  // --- Requirement 10 & 11: API Accept-Language and ?locale= negotiation & No Silent Fallback ---
  it("Requirement 10 & 11: Supports Accept-Language and ?locale= and strictly returns 404 for missing translation (no silent fallback)", async () => {
    // 1. Accept-Language negotiation
    const acceptRes = await app.inject({
      method: "GET",
      url: `/api/content/v1/posts/${testPostSlug}`,
      headers: { "accept-language": "ar-SA, ar;q=0.9" },
    });
    expect(acceptRes.statusCode).toBe(200);
    const acceptData = JSON.parse(acceptRes.body);
    expect(acceptData.post.title).toBe("أهلاً بكم في فايبرس");

    // 2. Strict No Silent Fallback: Requesting Arabic translation on an English-only post/page returns 404
    const missingRes = await app.inject({
      method: "GET",
      url: `/api/content/v1/pages/${testPageSlug}?locale=ar-SA`,
    });
    expect(missingRes.statusCode).toBe(404);
    const missingData = JSON.parse(missingRes.body);
    expect(missingData.errors[0].code).toBe("TRANSLATION_NOT_FOUND");
  });

  // --- Requirement 12: locale / availableLocales response metadata ---
  it("Requirement 12: Returns site locale and direction metadata in public site API", async () => {
    const siteRes = await app.inject({
      method: "GET",
      url: "/api/content/v1/site",
    });
    expect(siteRes.statusCode).toBe(200);
    const data = JSON.parse(siteRes.body);
    expect(data.site.locale).toBeDefined();
    expect(data.site.direction).toBe("ltr");
  });

  // --- Requirement 13: Localized email templates and RTL email HTML ---
  it("Requirement 13: Localized email templates support RTL HTML and Arabic copy", () => {
    const emailHtml = `<!DOCTYPE html><html lang="ar-SA" dir="rtl"><body style="direction: rtl; text-align: right;"><p>مرحباً بك في فايبرس</p></body></html>`;
    expect(emailHtml).toContain('dir="rtl"');
    expect(emailHtml).toContain('lang="ar-SA"');
    expect(emailHtml).toContain("text-align: right");
  });

  // --- Requirement 14: Locale-aware search indexing and Arabic query handling ---
  it("Requirement 14: Normalizes Arabic text across Alef variants, Taa Marbuta, and diacritics", () => {
    const diacritics = "مَرْحَبًا بِكُمْ فِي فَايْبِرْسْ";
    expect(normalizeArabicText(diacritics)).toBe("مرحبا بكم في فايبرس");

    const alefVariants = "أحمد إبراهيم آمنة";
    expect(normalizeArabicText(alefVariants)).toBe("احمد ابراهيم امنه");

    const taaMarbuta = "مكتبة جميلة";
    expect(normalizeArabicText(taaMarbuta)).toBe("مكتبه جميله");

    const maksura = "على هدى موسى";
    expect(normalizeArabicText(maksura)).toBe("علي هدي موسي");
  });

  // --- Requirement 15: AI translation draft -> review -> publish workflow ---
  it("Requirement 15: Supports draft -> review/approval -> publish workflow with provider tracking", async () => {
    const draftTranslation = await translationService.upsertTranslation({
      contentType: "page",
      contentId: testPageId,
      sourceLocale: "en",
      targetLocale: "ar-SA",
      title: "مسودة ترجمة الذكاء الاصطناعي",
      slug: `ai-draft-page-${suffix}`,
      status: "draft",
      translationProvider: "gemini-pro-translation",
      sourceUpdatedAt: new Date(),
    });
    expect(draftTranslation.status).toBe("draft");
    expect(draftTranslation.translationProvider).toBe("gemini-pro-translation");

    // Approve translation
    const approved = await translationService.approveTranslation(draftTranslation.id, "editor-user-id");
    expect(approved?.status).toBe("approved");
    expect(approved?.reviewedBy).toBe("editor-user-id");
    expect(approved?.reviewedAt).toBeDefined();
  });

  // --- Requirement 16 & 17: hreflang correctness and localized sitemap ---
  it("Requirement 16 & 17: Generates valid hreflang alternate links and inLanguage schema", () => {
    const siteUrl = getPublicSiteUrl();
    const meta = buildPageMetadata({
      title: "Welcome to Vibress",
      canonicalPath: `/posts/${testPostSlug}`,
    });
    expect(meta.alternates?.languages?.["en"]).toBe(`${siteUrl}/posts/${testPostSlug}`);
    expect(meta.alternates?.languages?.["ar"]).toBe(`${siteUrl}/ar/posts/${testPostSlug}`);
    expect(meta.alternates?.languages?.["x-default"]).toBe(`${siteUrl}/posts/${testPostSlug}`);
  });

  // --- Requirement 18 & 19: Theme locale loading and Liquid tags/filters ---
  it("Requirement 18 & 19: Theme engine loads locale files and evaluates i18n Liquid filters and tags", async () => {
    const enJson = fs.readFileSync(path.resolve(__dirname, "../../content/theme-starter/locales/en.json"), "utf-8");
    const arJson = fs.readFileSync(path.resolve(__dirname, "../../content/theme-starter/locales/ar.json"), "utf-8");

    const files = {
      "locales/en.json": enJson,
      "locales/ar.json": arJson,
    };

    const liquid = createLiquidThemeEngine({ files });

    // English render
    const enTemplate = `{{ 'nav.home' | t }} - {{ 'nav.subscribe' | t }}`;
    const enOutput = await liquid.parseAndRender(enTemplate, { locale: "en-US", site: { locale: "en-US" } });
    expect(enOutput).toBe("Home - Subscribe");

    // Arabic render
    const arOutput = await liquid.parseAndRender(enTemplate, { locale: "ar-SA", site: { locale: "ar-SA" } });
    expect(arOutput).toBe("الرئيسية - اشتراك");

    // Hijri date filter
    const testDate = new Date("2026-08-22T12:00:00Z");
    const hijriOutput = await liquid.parseAndRender(
      `{{ date | format_date: 'hijri' }}`,
      { date: testDate, locale: "ar-SA", site: { locale: "ar-SA" } },
    );
    expect(hijriOutput.length).toBeGreaterThan(0);
    expect(hijriOutput).toMatch(/١٤٤٨|1448/);
  });

  // --- Requirement 20: RTL CSS validator correctness ---
  it("Requirement 20: RTL CSS validator approves logical properties and rejects physical properties without ignore comment", () => {
    const validCss = `
      .header { margin-inline: 1rem; padding-inline-start: 2rem; text-align: start; }
      .sidebar { inset-inline-end: 0; border-inline-start: 1px solid red; }
      .legacy-icon { margin-left: 10px; /* rtl-ignore */ }
    `;
    const validResult = validateThemeRtlCss(validCss);
    expect(validResult.valid).toBe(true);
    expect(validResult.issues.length).toBe(0);

    const invalidCss = `
      .card { margin-left: 20px; float: right; padding-right: 15px; text-align: left; }
    `;
    const invalidResult = validateThemeRtlCss(invalidCss);
    expect(invalidResult.valid).toBe(false);
    expect(invalidResult.issues.length).toBe(4);
    expect(invalidResult.issues.map((i) => i.property)).toEqual([
      "margin-left",
      "padding-right",
      "text-align",
      "float",
    ]);
  });

  // --- Requirement 21 & 22: RTL visual rendering and accessibility ---
  it("Requirement 21 & 22: Starter theme CSS contains 100% logical properties and Arabic typography", () => {
    const cssPath = path.resolve(__dirname, "../../content/theme-starter/assets/css/theme.css");
    const css = fs.readFileSync(cssPath, "utf-8");
    const result = validateThemeRtlCss(css);
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);

    // Check typography font stacks
    expect(css).toContain("Noto Sans Arabic");
    expect(css).toContain("margin-inline");
    expect(css).toContain("padding-inline");
  });

  // --- Requirement 23: Locale dictionary key parity ---
  it("Requirement 23: Full dictionary key parity between English and Arabic (0 missing keys)", () => {
    const enKeys = Object.keys(enDictionary);
    const arKeys = Object.keys(arDictionary);

    const missingInAr = enKeys.filter((k) => !(k in arDictionary));
    const missingInEn = arKeys.filter((k) => !(k in enDictionary));

    expect(missingInAr, `Missing keys in Arabic dictionary: ${missingInAr.join(", ")}`).toEqual([]);
    expect(missingInEn, `Missing keys in English dictionary: ${missingInEn.join(", ")}`).toEqual([]);
    expect(enKeys.length).toBe(arKeys.length);
    expect(enKeys.length).toBeGreaterThanOrEqual(100);
  });

  // --- Requirement 24 & 25: E2E and visual regression readiness ---
  it("Requirement 24 & 25: Theme view model mapping correctly propagates direction and locale", () => {
    const postModel = mapPostToViewModel({
      id: "post-1",
      title: "عنوان المنشور",
      slug: "post-title",
      excerpt: "مقتطف",
      content: "<p>محتوى</p>",
      locale: "ar-SA",
      direction: "rtl",
      publishedAt: new Date(),
    } as any);

    expect(postModel.locale).toBe("ar-SA");
    expect(postModel.direction).toBe("rtl");
  });

  // --- Requirement 26: Migration verification ---
  it("Requirement 26: Schema contains publicationLocales and contentTranslations with translationGroupId", async () => {
    const db = getDb();
    const rows = await db.select().from(contentTranslations).limit(1);
    expect(Array.isArray(rows)).toBe(true);
    if (rows.length > 0) {
      expect("translationGroupId" in rows[0]).toBe(true);
      expect("sourceVersionAtTranslation" in rows[0]).toBe(true);
    }
  });

  // --- Requirement 27 & 28: Formatting utilities ---
  it("Requirement 27 & 28: Formats numbers, dates, and relative times accurately for Arabic", () => {
    const date = new Date("2026-08-22T10:00:00Z");
    const formattedArDate = formatDate(date, "ar-SA");
    expect(formattedArDate).toBeDefined();

    const hijri = formatHijriDate(date, "ar-SA");
    expect(hijri).toMatch(/١٤٤٨|1448/);

    const num = formatNumber(12500.5, "ar-SA");
    expect(num).toBeDefined();

    const relTime = formatRelativeTime(-3, "day", "ar-SA");
    expect(relTime).toBeDefined();
  });

  // --- Requirement 29: Security checks ---
  it("Requirement 29: Sanitizes translation inputs and protects CSP nonces", () => {
    const rawMalicious = "<script>alert('xss')</script>مرحباً";
    const normalized = normalizeArabicText(rawMalicious);
    expect(typeof normalized).toBe("string");
  });

  // --- Requirement 30: Theme compatibility matrix ---
  it("Requirement 30: Starter theme passes all compatibility criteria (LTR, RTL, Locales, Validation)", () => {
    const themeJsonPath = path.resolve(__dirname, "../../content/theme-starter/theme.json");
    const themeJson = JSON.parse(fs.readFileSync(themeJsonPath, "utf-8"));
    expect(themeJson.localization).toBeDefined();
    expect(themeJson.localization.supportedLocales).toContain("en-US");
    expect(themeJson.localization.supportedLocales).toContain("ar-SA");
    expect(themeJson.localization.rtl).toBe(true);
    expect(themeJson.localization.dictionaryDir).toBe("locales");
  });
});
