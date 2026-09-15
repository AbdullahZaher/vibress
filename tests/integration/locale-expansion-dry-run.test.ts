import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  defaultLocaleRegistry,
  formatDate,
  formatNumber,
  formatRelativeTime,
  getDirection,
  isRtl,
  getLocalePrefix,
} from "@vibress/i18n";
import { TranslationService } from "@vibress/i18n/server";
import {
  getDb,
  posts,
  contentTranslations,
  pages,
  systemSettings,
  users,
} from "@vibress/database";
import { createLiquidThemeEngine } from "@vibress/theme-core";
import { buildPublicPostSummaryDto } from "../../apps/api/src/helpers/public-content-helpers";
import { buildApp } from "../../apps/api/src/main";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import * as path from "path";
import * as fs from "fs";

describe("Locale Expansion Dry Run (fr-FR LTR & fa-IR RTL)", () => {
  let app: any;
  const translationService = new TranslationService();
  const db = getDb();

  const authorId = randomUUID();
  const testPostId = randomUUID();
  const testGroupId = randomUUID();

  const englishPostSlug = `dry-run-welcome-${randomUUID().slice(0, 8)}`;
  const frenchPostSlug = `bienvenue-vibress-${randomUUID().slice(0, 8)}`;
  const persianPostSlug = `khosh-amadid-${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    const now = new Date();

    // 1. Seed author user
    await db.insert(users).values({
      id: authorId,
      email: `dryrun-${Date.now()}@vibress.org`,
      passwordHash: "dummyhash",
      name: "Dry Run Author",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });

    // 2. Seed English source post
    await db.insert(posts).values({
      id: testPostId,
      publicationId: "pub_default",
      translationGroupId: testGroupId,
      locale: "en",
      title: "Dry Run Source Post",
      slug: englishPostSlug,
      excerpt: "Testing locale expansion for Vibress.",
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "English source post content." }],
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

    // 3. Seed French translation (fr-FR LTR)
    await db.insert(contentTranslations).values({
      id: randomUUID(),
      publicationId: "pub_default",
      translationGroupId: testGroupId,
      contentType: "post",
      contentId: testPostId,
      sourceLocale: "en",
      targetLocale: "fr-FR",
      title: "Bienvenue sur Vibress",
      slug: frenchPostSlug,
      excerpt: "Plateforme de publication moderne.",
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Contenu en français pour le test d'expansion." }],
          },
        ],
      },
      metaTitle: "Bienvenue sur Vibress | Plateforme",
      metaDescription: "Plateforme de publication moderne.",
      status: "published",
      translationProvider: "human",
      translatedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    // 4. Seed Persian translation (fa-IR RTL)
    await db.insert(contentTranslations).values({
      id: randomUUID(),
      publicationId: "pub_default",
      translationGroupId: testGroupId,
      contentType: "post",
      contentId: testPostId,
      sourceLocale: "en",
      targetLocale: "fa-IR",
      title: "به وایبرس خوش آمدید",
      slug: persianPostSlug,
      excerpt: "پلتفرم مدرن انتشار محتوا.",
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "محتوای فارسی برای تست توسعه زبان‌ها." }],
          },
        ],
      },
      metaTitle: "به وایبرس خوش آمدید | پلتفرم",
      metaDescription: "پلتفرم مدرن انتشار محتوا.",
      status: "published",
      translationProvider: "human",
      translatedAt: now,
      createdAt: now,
      updatedAt: now,
    });
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  // --- French LTR Verification ---
  describe("French (fr-FR / LTR) Expansion Pass", () => {
    it("recognizes fr-FR in defaultLocaleRegistry as LTR", () => {
      const def = defaultLocaleRegistry.get("fr-FR");
      expect(def).toBeDefined();
      expect(def?.language).toBe("fr");
      expect(def?.direction).toBe("ltr");
      expect(def?.nativeName).toBe("Français");
      expect(isRtl("fr-FR")).toBe(false);
      expect(getDirection("fr-FR")).toBe("ltr");
      expect(getLocalePrefix("fr-FR")).toBe("/fr");
    });

    it("formats dates, numbers, and relative times accurately in French", () => {
      const date = new Date(2026, 7, 23);
      const formattedDate = formatDate(date, "fr-FR", { dateStyle: "long" });
      expect(formattedDate.toLowerCase()).toContain("août");

      const num = formatNumber(12345.67, "fr-FR");
      expect(num).toMatch(/12[\s\u202F]345,67/);

      const past = new Date(Date.now() - 2 * 60 * 60 * 1000);
      const relTime = formatRelativeTime(past, "fr-FR");
      expect(relTime).toContain("heures");
    });

    it("retrieves French translation by localized slug directly via API", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/content/v1/posts/${frenchPostSlug}`,
      });
      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.post.title).toBe("Bienvenue sur Vibress");
      expect(data.post.slug).toBe(frenchPostSlug);
    });

    it("serves French translation when requesting source slug with Accept-Language: fr-FR", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/content/v1/posts/${englishPostSlug}`,
        headers: {
          "Accept-Language": "fr-FR,fr;q=0.9",
        },
      });
      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.post.title).toBe("Bienvenue sur Vibress");
    });

    it("generates correct canonical URL with /fr prefix in public post summary DTO", async () => {
      const dto = await buildPublicPostSummaryDto(
        {
          id: testPostId,
          title: "Bienvenue sur Vibress",
          slug: frenchPostSlug,
          excerpt: "Plateforme de publication moderne.",
          content: {},
          locale: "fr-FR",
          direction: "ltr",
          featureImage: null,
          featured: false,
          status: "published",
          visibility: "public",
          publishedAt: new Date(),
          updatedAt: new Date(),
          readingTimeMinutes: 2,
        } as any,
        [],
        [],
        null as any,
      );

      expect(dto.seo?.canonicalUrl).toBe(`http://localhost:7777/fr/posts/${frenchPostSlug}`);
    });
  });

  // --- Persian RTL Verification ---
  describe("Persian (fa-IR / RTL) Expansion Pass", () => {
    it("recognizes fa-IR in defaultLocaleRegistry as RTL", () => {
      const def = defaultLocaleRegistry.get("fa-IR");
      expect(def).toBeDefined();
      expect(def?.language).toBe("fa");
      expect(def?.direction).toBe("rtl");
      expect(def?.nativeName).toBe("فارسی (ایران)");
      expect(isRtl("fa-IR")).toBe(true);
      expect(getDirection("fa-IR")).toBe("rtl");
      expect(getLocalePrefix("fa-IR")).toBe("/fa");
    });

    it("formats numbers in Persian digits", () => {
      const formattedNum = formatNumber(12500, "fa-IR");
      expect(formattedNum).toContain("۱۲٬۵۰۰");
    });

    it("retrieves Persian translation by localized slug directly via API", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/content/v1/posts/${persianPostSlug}`,
      });
      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.post.title).toBe("به وایبرس خوش آمدید");
      expect(data.post.slug).toBe(persianPostSlug);
    });

    it("serves Persian translation when requesting with ?locale=fa-IR", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/content/v1/posts/${englishPostSlug}?locale=fa-IR`,
      });
      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.post.title).toBe("به وایبرس خوش آمدید");
    });

    it("generates correct canonical URL with /fa prefix for Persian posts", async () => {
      const dto = await buildPublicPostSummaryDto(
        {
          id: testPostId,
          title: "به وایبرس خوش آمدید",
          slug: persianPostSlug,
          excerpt: "پلتفرم مدرن انتشار محتوا.",
          content: {},
          locale: "fa-IR",
          direction: "rtl",
          featureImage: null,
          featured: false,
          status: "published",
          visibility: "public",
          publishedAt: new Date(),
          updatedAt: new Date(),
          readingTimeMinutes: 2,
        } as any,
        [],
        [],
        null as any,
      );

      expect(dto.seo?.canonicalUrl).toBe(`http://localhost:7777/fa/posts/${persianPostSlug}`);
    });

    it("renders theme Liquid engine with Persian RTL direction context", async () => {
      const starterDir = path.resolve(__dirname, "../../content/theme-starter");
      const files = new Map<string, string>();
      function load(dir: string, prefix = "") {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const full = path.join(dir, entry.name);
          const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
          if (entry.isDirectory()) {
            load(full, rel);
          } else {
            files.set(rel, fs.readFileSync(full, "utf-8"));
          }
        }
      }
      load(starterDir);

      const engine = createLiquidThemeEngine({
        files,
        themeId: "vibress-starter-theme",
        themeVersion: "1.0.0",
      });

      const html = await engine.renderFile("templates/home.liquid", {
        site: {
          id: "site-1",
          title: "Vibress Persian",
          description: "وبلاگ فارسی",
          url: "https://vibress.org/fa",
          locale: "fa-IR",
          direction: "rtl",
          navigation: [],
          secondaryNavigation: [],
        },
        posts: [],
        pagination: {
          page: 1,
          limit: 10,
          total: 0,
          totalPages: 0,
          prevPage: null,
          nextPage: null,
        },
        locale: "fa-IR",
        localeContext: {
          locale: "fa-IR",
          language: "fa",
          direction: "rtl",
          isRTL: true,
          availableLocales: [
            { code: "en", name: "English", nativeName: "English", direction: "ltr", url: "/", isCurrent: false },
            { code: "fa-IR", name: "Persian", nativeName: "فارسی", direction: "rtl", url: "/fa", isCurrent: true },
          ],
          currentUrl: "/fa",
        },
      });

      expect(html).toBeDefined();
      expect(typeof html).toBe("string");
    });
  });
});
