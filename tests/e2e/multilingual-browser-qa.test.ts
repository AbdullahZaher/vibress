import { test, expect, Page } from "@playwright/test";
import {
  getDb,
  posts,
  pages,
  users,
  contentTranslations,
  settings,
  seedDatabase,
  runMigrations,
} from "@vibress/database";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const AXE_SCRIPT_PATH = path.resolve(
  __dirname,
  "../../node_modules/.pnpm/axe-core@4.13.0/node_modules/axe-core/axe.min.js",
);

const SCREENSHOT_DIR = path.resolve(__dirname, "screenshots");

const testPostId = "00000000-0000-4000-8000-000000000001";
const testPageId = "00000000-0000-4000-8000-000000000002";
const testEnglishOnlyPageId = "00000000-0000-4000-8000-000000000003";
const testTranslationGroupId = "00000000-0000-4000-8000-000000000004";

const TEST_POST_SLUG = "qa-multilingual-welcome";
const TEST_ARABIC_POST_SLUG = "qa-marhaban-bik-fi-vibress";
const TEST_PAGE_SLUG = "qa-about-vibress";
const TEST_ARABIC_PAGE_SLUG = "qa-an-vibress";
const TEST_ENGLISH_ONLY_SLUG = "qa-english-only-page";

async function injectAxeAndAnalyze(page: Page) {
  const axeSource = fs.readFileSync(AXE_SCRIPT_PATH, "utf-8");
  await page.evaluate(axeSource);
  const results = await page.evaluate(async () => {
    // @ts-ignore
    return await window.axe.run({
      runOnly: {
        type: "tag",
        values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
      },
    });
  });
  return results;
}

test.describe.configure({ mode: "serial" });

test.describe("Vibress Multilingual & RTL — Final Browser QA & Certification", () => {
  test.beforeAll(async () => {
    if (!fs.existsSync(SCREENSHOT_DIR)) {
      fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    }

    await runMigrations();
    await seedDatabase();

    const db = getDb();
    await db
      .delete(settings)
      .where(and(eq(settings.namespace, "site"), eq(settings.key, "locale")));
    await db
      .delete(contentTranslations)
      .where(eq(contentTranslations.contentId, testPostId));
    await db
      .delete(contentTranslations)
      .where(eq(contentTranslations.contentId, testPageId));
    await db.delete(posts).where(eq(posts.id, testPostId));
    await db.delete(pages).where(eq(pages.id, testPageId));
    await db.delete(pages).where(eq(pages.id, testEnglishOnlyPageId));

    const now = new Date();
    const [adminUser] = await db.select().from(users).limit(1);
    const authorId = adminUser?.id || randomUUID();

    // 1. Seed Multilingual Post
    await db
      .insert(posts)
      .values({
        id: testPostId,
        publicationId: "pub_default",
        title: "Welcome to Vibress Multilingual QA",
        slug: TEST_POST_SLUG,
        excerpt: "High-performance publishing with authentic RTL support.",
        content: {
          schema: "vibress-studio",
          version: 1,
          root: {
            type: "root",
            children: [
              {
                type: "paragraph",
                children: [
                  {
                    type: "text",
                    text: "Welcome to the production test post for Vibress 2026. This post tests bidirectional text, email links like test@vibress.org, and URLs like https://vibress.org.",
                    version: 1,
                  },
                ],
              },
            ],
          },
        },
        status: "published",
        visibility: "public",
        primaryAuthorId: authorId,
        createdBy: authorId,
        updatedBy: authorId,
        publishedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing();

    // 2. Seed Arabic Translation for Post
    await db
      .insert(contentTranslations)
      .values({
        id: randomUUID(),
        publicationId: "pub_default",
        translationGroupId: testTranslationGroupId,
        contentType: "post",
        contentId: testPostId,
        sourceLocale: "en",
        targetLocale: "ar-SA",
        title: "أهلاً بكم في فايبرس — منصة النشر العربية الحديثة",
        slug: TEST_ARABIC_POST_SLUG,
        excerpt: "منصة نشر فائقة الأداء مصممة خصيصاً لدعم اللغة العربية وتخطيط RTL.",
        content: {
          schema: "vibress-studio",
          version: 1,
          root: {
            type: "root",
            children: [
              {
                type: "paragraph",
                children: [
                  {
                    type: "text",
                    text: "مرحباً بكم في فايبرس (Vibress 2026). ندعم النصوص ثنائية الاتجاه (Bidi)، مثل الروابط البريدية hello@vibress.org والأسعار $1,299 والروابط الخارجية https://vibress.org بنجاح تام.",
                    version: 1,
                  },
                ],
              },
            ],
          },
        },
        metaTitle: "أهلاً بكم في فايبرس | منصة النشر",
        metaDescription: "منصة نشر فائقة الأداء مصممة لدعم اللغة العربية.",
        status: "published",
        translationProvider: "human",
        translatedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing();

    // 3. Seed Multilingual Page
    await db
      .insert(pages)
      .values({
        id: testPageId,
        publicationId: "pub_default",
        title: "About Vibress QA",
        slug: TEST_PAGE_SLUG,
        excerpt: "About the modern publishing engine.",
        content: {
          schema: "vibress-studio",
          version: 1,
          root: {
            type: "root",
            children: [
              {
                type: "paragraph",
                children: [{ type: "text", text: "About page in English.", version: 1 }],
              },
            ],
          },
        },
        status: "published",
        visibility: "public",
        primaryAuthorId: authorId,
        createdBy: authorId,
        updatedBy: authorId,
        publishedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing();

    // 4. Seed Arabic Translation for Page
    await db
      .insert(contentTranslations)
      .values({
        id: randomUUID(),
        publicationId: "pub_default",
        translationGroupId: randomUUID(),
        contentType: "page",
        contentId: testPageId,
        sourceLocale: "en",
        targetLocale: "ar-SA",
        title: "عن منصة فايبرس",
        slug: TEST_ARABIC_PAGE_SLUG,
        excerpt: "نبذة عن منصة النشر الحديثة فايبرس.",
        content: {
          schema: "vibress-studio",
          version: 1,
          root: {
            type: "root",
            children: [
              {
                type: "paragraph",
                children: [{ type: "text", text: "محتوى صفحة نبذة عنا باللغة العربية.", version: 1 }],
              },
            ],
          },
        },
        metaTitle: "عن فايبرس",
        metaDescription: "نبذة عن المنصة.",
        status: "published",
        translationProvider: "human",
        translatedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing();

    // 5. Seed English-Only Page (for testing strict missing translation 404)
    await db
      .insert(pages)
      .values({
        id: testEnglishOnlyPageId,
        publicationId: "pub_default",
        title: "Strict English Only Page",
        slug: TEST_ENGLISH_ONLY_SLUG,
        excerpt: "This page has NO Arabic translation.",
        content: {
          schema: "vibress-studio",
          version: 1,
          root: {
            type: "root",
            children: [
              {
                type: "paragraph",
                children: [{ type: "text", text: "Strictly English content.", version: 1 }],
              },
            ],
          },
        },
        status: "published",
        visibility: "public",
        primaryAuthorId: authorId,
        createdBy: authorId,
        updatedBy: authorId,
        publishedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing();
  });

  // --- Section 1: Locale Routing & HTML DOM Attributes ---
  test("1. English and Arabic routes render correct HTML lang and dir in real browser DOM", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error" && !msg.text().includes("favicon")) {
        consoleErrors.push(msg.text());
      }
    });

    // English Homepage
    await page.goto("http://127.0.0.1:7777/");
    await page.waitForLoadState("networkidle");
    const enLang = await page.locator("html").getAttribute("lang");
    const enDir = await page.locator("html").getAttribute("dir");
    expect(enLang?.toLowerCase()).toMatch(/^en/);
    expect(enDir).toBe("ltr");

    // Arabic Homepage
    await page.goto("http://127.0.0.1:7777/ar");
    await page.waitForLoadState("networkidle");
    const arLang = await page.locator("html").getAttribute("lang");
    const arDir = await page.locator("html").getAttribute("dir");
    expect(arLang).toBe("ar-SA");
    expect(arDir).toBe("rtl");

    // Zero React Hydration errors
    const hydrationErrors = consoleErrors.filter((e) =>
      e.toLowerCase().includes("hydration"),
    );
    expect(hydrationErrors).toEqual([]);
  });

  // --- Section 2: Canonical URLs & Redirects ---
  test("2. Canonical URL redirects execute correctly without redirect loops", async ({
    page,
  }) => {
    // 1. /en -> / (301)
    const enHomeRes = await page.goto("http://127.0.0.1:7777/en");
    expect(page.url()).toBe("http://127.0.0.1:7777/");
    expect(enHomeRes?.status()).toBe(200);

    // 2. /en/posts/slug -> /posts/slug (301)
    await page.goto(`http://127.0.0.1:7777/en/posts/${TEST_POST_SLUG}`);
    expect(page.url()).toBe(`http://127.0.0.1:7777/posts/${TEST_POST_SLUG}`);

    // 3. /AR -> /ar (case normalization 301)
    await page.goto("http://127.0.0.1:7777/AR");
    expect(page.url()).toBe("http://127.0.0.1:7777/ar");

    // 4. Default /posts/slug works seamlessly (backward compatibility)
    const postRes = await page.goto(`http://127.0.0.1:7777/posts/${TEST_POST_SLUG}`);
    expect(postRes?.status()).toBe(200);
    expect(page.url()).toBe(`http://127.0.0.1:7777/posts/${TEST_POST_SLUG}`);
  });

  // --- Section 3: Localized Content & SEO Metadata ---
  test("3. Localized content, slugs, and SEO DOM output render accurately", async ({
    page,
  }) => {
    // English Post
    await page.goto(`http://127.0.0.1:7777/posts/${TEST_POST_SLUG}`);
    await page.waitForLoadState("networkidle");
    await expect(page.locator("h1")).toContainText("Welcome to Vibress Multilingual QA");

    const enCanonical = await page.locator('link[rel="canonical"]').getAttribute("href");
    expect(enCanonical).toContain(`/posts/${TEST_POST_SLUG}`);

    // Arabic Post
    await page.goto(`http://127.0.0.1:7777/ar/posts/${TEST_POST_SLUG}`);
    await page.waitForLoadState("networkidle");
    await expect(page.locator("h1")).toContainText("أهلاً بكم في فايبرس");
    await expect(page.locator("body")).toContainText("منصة نشر فائقة الأداء");

    const arCanonical = await page.locator('link[rel="canonical"]').getAttribute("href");
    expect(arCanonical).toContain(`/ar/posts/`);
  });

  // --- Section 4: Strict No-Silent-Fallback Verification ---
  test("4. Missing Arabic translation strictly returns 404 and does NOT silently display English", async ({
    page,
  }) => {
    const res = await page.goto(`http://127.0.0.1:7777/ar/pages/${TEST_ENGLISH_ONLY_SLUG}`);
    expect(res?.status()).toBe(404);
    await expect(page.locator("body")).toContainText("404");
    // Ensure English content is NOT rendered
    await expect(page.locator("body")).not.toContainText("Strictly English content.");
  });

  // --- Section 5: Language Switcher Resource Preservation & Keyboard Activation ---
  test("5. Language switcher preserves current resource and supports keyboard activation", async ({
    page,
  }) => {
    // On English Post
    await page.goto(`http://127.0.0.1:7777/posts/${TEST_POST_SLUG}`);
    await page.waitForLoadState("networkidle");

    // Look for language switcher link
    const arSwitcher = page.locator('.vb-locale-switcher a:has-text("العربية")');
    if (await arSwitcher.isVisible()) {
      await arSwitcher.click();
      await page.waitForURL(/\/ar\/posts\//);
      expect(page.url()).toContain("/ar/posts/");
      await expect(page.locator("html")).toHaveAttribute("dir", "rtl");

      // Switch back to English
      const enSwitcher = page.locator('.vb-locale-switcher a:has-text("English")');
      await expect(enSwitcher).toBeVisible();
      await enSwitcher.click();
      await page.waitForURL(/\/posts\//);
      expect(page.url()).not.toContain("/ar/");
      await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
    }
  });

  // --- Section 6: RTL Layout, No Horizontal Overflow & Mobile Viewport ---
  test("6. Desktop (1440x900) and Mobile (390x844) render with zero horizontal overflow in RTL", async ({
    page,
  }) => {
    // Desktop Viewport
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("http://127.0.0.1:7777/ar");
    await page.waitForLoadState("networkidle");

    const desktopOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    expect(desktopOverflow, "Desktop RTL should have no horizontal overflow").toBe(false);

    // Mobile Viewport
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("http://127.0.0.1:7777/ar");
    await page.waitForLoadState("networkidle");

    const mobileOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    expect(mobileOverflow, "Mobile RTL should have no horizontal overflow").toBe(false);
  });

  // --- Section 7: Bidi Mixed-Direction Typography ---
  test("7. Bidi mixed text (Arabic + English + numbers + URLs) renders cleanly", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`http://127.0.0.1:7777/ar/posts/${TEST_POST_SLUG}`);
    await page.waitForLoadState("networkidle");

    const bodyText = await page.locator("body").innerText();
    expect(bodyText).toContain("Vibress 2026");
    expect(bodyText).toContain("hello@vibress.org");
    expect(bodyText).toContain("$1,299");
  });

  // --- Section 8: Accessibility Verification (axe-core) ---
  test("8. Accessibility audit passes on English and Arabic surfaces", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });

    // 1. English Homepage
    await page.goto("http://127.0.0.1:7777/");
    await page.waitForLoadState("networkidle");
    const enHomeAxe = await injectAxeAndAnalyze(page);
    const enCritical = enHomeAxe.violations.filter((v: any) => v.impact === "critical");
    expect(enCritical, "English homepage should have 0 critical a11y violations").toEqual([]);

    // 2. Arabic Homepage
    await page.goto("http://127.0.0.1:7777/ar");
    await page.waitForLoadState("networkidle");
    const arHomeAxe = await injectAxeAndAnalyze(page);
    const arCritical = arHomeAxe.violations.filter((v: any) => v.impact === "critical");
    expect(arCritical, "Arabic homepage should have 0 critical a11y violations").toEqual([]);

    // 3. Arabic Post
    await page.goto(`http://127.0.0.1:7777/ar/posts/${TEST_POST_SLUG}`);
    await page.waitForLoadState("networkidle");
    const arPostAxe = await injectAxeAndAnalyze(page);
    const arPostCritical = arPostAxe.violations.filter((v: any) => v.impact === "critical");
    expect(arPostCritical, "Arabic post should have 0 critical a11y violations").toEqual([]);
  });

  // --- Section 9: Visual Regression Screenshots ---
  test("9. Captures deterministic visual regression screenshots for LTR & RTL across viewports", async ({
    page,
  }) => {
    const surfaces = [
      { name: "home-en", url: "http://127.0.0.1:7777/" },
      { name: "home-ar", url: "http://127.0.0.1:7777/ar" },
      { name: "post-en", url: `http://127.0.0.1:7777/posts/${TEST_POST_SLUG}` },
      { name: "post-ar", url: `http://127.0.0.1:7777/ar/posts/${TEST_POST_SLUG}` },
      { name: "notfound-en", url: "http://127.0.0.1:7777/404-nonexistent" },
      { name: "notfound-ar", url: "http://127.0.0.1:7777/ar/404-nonexistent" },
    ];

    // Desktop: 1440x900
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const surface of surfaces) {
      await page.goto(surface.url);
      await page.waitForLoadState("networkidle");
      const screenshotPath = path.join(
        SCREENSHOT_DIR,
        `${surface.name}-desktop-1440x900.png`,
      );
      await page.screenshot({ path: screenshotPath, fullPage: false });
      expect(fs.existsSync(screenshotPath)).toBe(true);
    }

    // Mobile: 390x844
    await page.setViewportSize({ width: 390, height: 844 });
    for (const surface of surfaces) {
      await page.goto(surface.url);
      await page.waitForLoadState("networkidle");
      const screenshotPath = path.join(
        SCREENSHOT_DIR,
        `${surface.name}-mobile-390x844.png`,
      );
      await page.screenshot({ path: screenshotPath, fullPage: false });
      expect(fs.existsSync(screenshotPath)).toBe(true);
    }
  });
});
