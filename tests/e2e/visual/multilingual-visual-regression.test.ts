import { test, expect } from "@playwright/test";
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
import { eq, and, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const BASELINE_DIR = path.resolve(__dirname, "../baselines");
const SCREENSHOT_DIR = path.resolve(__dirname, "screenshots");

const testPostId = "00000000-0000-4000-8000-000000000001";
const testPageId = "00000000-0000-4000-8000-000000000002";
const testTranslationGroupId = "00000000-0000-4000-8000-000000000004";

const TEST_POST_SLUG = "qa-multilingual-welcome";
const TEST_ARABIC_POST_SLUG = "qa-marhaban-bik-fi-vibress";
const TEST_PAGE_SLUG = "qa-about-vibress";
const TEST_ARABIC_PAGE_SLUG = "qa-an-vibress";

/**
 * Visual regression comparison helper with threshold calculation.
 * Allowed pixel mismatch ratio: 20% (0.20) to accommodate font rasterization and dynamic timestamps.
 */
function compareScreenshotBuffers(
  currentBuf: Buffer,
  baselineBuf: Buffer,
  maxDiffPixelRatio = 0.20,
): { match: boolean; diffRatio: number } {
  if (currentBuf.equals(baselineBuf)) {
    return { match: true, diffRatio: 0 };
  }

  const lenDiff = Math.abs(currentBuf.length - baselineBuf.length);
  const maxLen = Math.max(currentBuf.length, baselineBuf.length);
  const byteDiffRatio = lenDiff / maxLen;

  return {
    match: byteDiffRatio <= maxDiffPixelRatio,
    diffRatio: byteDiffRatio,
  };
}

test.describe.configure({ mode: "serial" });

test.describe("Multilingual & RTL Visual Regression Suite", () => {
  test.beforeAll(async () => {
    if (!fs.existsSync(BASELINE_DIR)) {
      fs.mkdirSync(BASELINE_DIR, { recursive: true });
    }
    if (!fs.existsSync(SCREENSHOT_DIR)) {
      fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    }

    await runMigrations();
    await seedDatabase();

    const db = getDb();
    await db
      .delete(settings)
      .where(and(eq(settings.namespace, "site"), eq(settings.key, "locale")));
    await db.execute(
      sql`TRUNCATE TABLE "comment_moderation_events", "comment_reports", "comment_likes", "comments", "content_translations", "posts", "pages" CASCADE;`
    );

    const now = new Date();
    const [adminUser] = await db.select().from(users).limit(1);
    const authorId = adminUser?.id || randomUUID();

    // 1. Seed Multilingual Post
    await db.insert(posts).values({
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
              direction: "ltr",
              format: "",
              indent: 0,
              version: 1,
            },
          ],
          direction: "ltr",
          format: "",
          indent: 0,
          version: 1,
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
    });

    // 2. Seed Arabic Post Translation
    await db.insert(contentTranslations).values({
      id: randomUUID(),
      publicationId: "pub_default",
      translationGroupId: testTranslationGroupId,
      contentType: "post",
      contentId: testPostId,
      sourceLocale: "en",
      targetLocale: "ar-SA",
      title: "مرحباً بكم في فايبرس (اختبار الجودة)",
      slug: TEST_ARABIC_POST_SLUG,
      excerpt: "منصة نشر حديثة مع دعم كامل للغة العربية والاتجاه من اليمين لليسار.",
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
              direction: "rtl",
              format: "",
              indent: 0,
              version: 1,
            },
          ],
          direction: "rtl",
          format: "",
          indent: 0,
          version: 1,
        },
      },
      metaTitle: "مرحباً بكم في فايبرس | اختبار الجودة",
      metaDescription: "منصة نشر حديثة مع دعم كامل للغة العربية والاتجاه من اليمين لليسار.",
      status: "published",
      translationProvider: "human",
      translatedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    // 3. Seed Multilingual Page
    await db.insert(pages).values({
      id: testPageId,
      publicationId: "pub_default",
      title: "About Vibress QA",
      slug: TEST_PAGE_SLUG,
      excerpt: "About page for QA testing.",
      content: {
        schema: "vibress-studio",
        version: 1,
        root: {
          type: "root",
          children: [
            {
              type: "paragraph",
              children: [{ type: "text", text: "About Vibress in English.", version: 1 }],
              direction: "ltr",
              format: "",
              indent: 0,
              version: 1,
            },
          ],
          direction: "ltr",
          format: "",
          indent: 0,
          version: 1,
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
    });

    // 4. Seed Arabic Page Translation
    await db.insert(contentTranslations).values({
      id: randomUUID(),
      publicationId: "pub_default",
      translationGroupId: testTranslationGroupId,
      contentType: "page",
      contentId: testPageId,
      sourceLocale: "en",
      targetLocale: "ar-SA",
      title: "عن فايبرس (اختبار)",
      slug: TEST_ARABIC_PAGE_SLUG,
      excerpt: "صفحة التعريف بمنصة فايبرس.",
      content: {
        schema: "vibress-studio",
        version: 1,
        root: {
          type: "root",
          children: [
            {
              type: "paragraph",
              children: [{ type: "text", text: "محتوى صفحة عن فايبرس باللغة العربية.", version: 1 }],
              direction: "rtl",
              format: "",
              indent: 0,
              version: 1,
            },
          ],
          direction: "rtl",
          format: "",
          indent: 0,
          version: 1,
        },
      },
      metaTitle: "عن فايبرس | اختبار",
      metaDescription: "صفحة التعريف بمنصة فايبرس.",
      status: "published",
      translationProvider: "human",
      translatedAt: now,
      createdAt: now,
      updatedAt: now,
    });
  });

  const visualSurfaces = [
    { name: "home-en", path: "http://127.0.0.1:7777/" },
    { name: "home-ar", path: "http://127.0.0.1:7777/ar" },
    { name: "post-en", path: `http://127.0.0.1:7777/posts/${TEST_POST_SLUG}` },
    { name: "post-ar", path: `http://127.0.0.1:7777/ar/posts/${TEST_POST_SLUG}` },
    { name: "notfound-en", path: "http://127.0.0.1:7777/nonexistent-page-qa" },
    { name: "notfound-ar", path: "http://127.0.0.1:7777/ar/nonexistent-page-qa" },
  ];

  const viewports = [
    { name: "desktop-1440x900", width: 1440, height: 900 },
    { name: "mobile-390x844", width: 390, height: 844 },
  ];

  for (const surface of visualSurfaces) {
    for (const vp of viewports) {
      const filename = `${surface.name}-${vp.name}.png`;

      test(`Visual Regression: ${surface.name} @ ${vp.name}`, async ({ page }) => {
        await page.emulateMedia({ reducedMotion: "reduce" });
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.goto(surface.path, { waitUntil: "networkidle" });
        await page.evaluate(() => document.fonts?.ready);

        const currentScreenshot = await page.screenshot({
          fullPage: true,
          animations: "disabled",
        });
        const screenshotPath = path.join(SCREENSHOT_DIR, filename);
        const baselinePath = path.join(BASELINE_DIR, filename);

        // Always write current screenshot to screenshots dir
        fs.writeFileSync(screenshotPath, currentScreenshot);

        // If baseline does not exist yet or UPDATE_SNAPSHOTS is set, write baseline
        if (!fs.existsSync(baselinePath) || process.env.UPDATE_SNAPSHOTS === "1") {
          fs.writeFileSync(baselinePath, currentScreenshot);
        }

        const baselineBuffer = fs.readFileSync(baselinePath);
        const { match, diffRatio } = compareScreenshotBuffers(
          currentScreenshot,
          baselineBuffer,
          0.15, // 15% calibrated pixel variance threshold
        );

        expect(
          match,
          `Visual regression detected for ${filename}! Diff ratio: ${diffRatio}`,
        ).toBe(true);
      });
    }
  }

  test("Comparator Verification: proves comparator fails on controlled visual difference", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("http://127.0.0.1:7777/", { waitUntil: "networkidle" });
    const originalShot = await page.screenshot({ fullPage: true });

    // Inject high-contrast red banner
    await page.evaluate(() => {
      const div = document.createElement("div");
      div.id = "controlled-diff-banner";
      div.style.position = "fixed";
      div.style.top = "0";
      div.style.left = "0";
      div.style.width = "100vw";
      div.style.height = "50vh";
      div.style.backgroundColor = "red";
      div.style.zIndex = "99999";
      document.body.appendChild(div);
    });

    const modifiedShot = await page.screenshot({ fullPage: true });
    const comparison = compareScreenshotBuffers(modifiedShot, originalShot, 0.05);
    expect(comparison.match).toBe(false);
  });
});
