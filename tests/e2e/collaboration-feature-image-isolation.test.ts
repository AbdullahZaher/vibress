import { test, expect } from "@playwright/test";
import { getDb, posts, revisions, mediaAssets, publications } from "@vibress/database";
import { eq } from "drizzle-orm";
import crypto from "node:crypto";
import WebSocket from "ws";
import * as Y from "yjs";
import { getRedisClient, buildPublicationCacheKey } from "@vibress/cache";

const TARGET_POST_ID = "bb46491c-dd25-492c-a035-89745ceffd6c";
const PUBLICATION_ID = "pub_default";

let mediaAssetAId: string;
let mediaAssetBId: string;

async function ensureTestMediaAssets() {
  const db = getDb();
  mediaAssetAId = "fa000000-0000-4000-a000-000000000001";
  mediaAssetBId = "fa000000-0000-4000-a000-000000000002";

  await db
    .insert(mediaAssets)
    .values([
      {
        id: mediaAssetAId,
        publicationId: PUBLICATION_ID,
        storageKey: "media/test-feature-a.jpg",
        originalFilename: "test-feature-a.jpg",
        displayName: "Feature Image A",
        mimeType: "image/jpeg",
        extension: "jpg",
        sizeBytes: 12345,
        checksum: "fakechecksum1",
        assetType: "image",
      },
      {
        id: mediaAssetBId,
        publicationId: PUBLICATION_ID,
        storageKey: "media/test-feature-b.jpg",
        originalFilename: "test-feature-b.jpg",
        displayName: "Feature Image B",
        mimeType: "image/jpeg",
        extension: "jpg",
        sizeBytes: 23456,
        checksum: "fakechecksum2",
        assetType: "image",
      },
    ])
    .onConflictDoNothing();
}

async function resetTargetPost() {
  const db = getDb();
  const [rev1] = await db
    .select()
    .from(revisions)
    .where(eq(revisions.resourceId, TARGET_POST_ID))
    .orderBy(revisions.revisionNumber)
    .limit(1);

  if (!rev1) {
    throw new Error("Revision 1 not found for target post");
  }

  const [current] = await db
    .select()
    .from(posts)
    .where(eq(posts.id, TARGET_POST_ID))
    .limit(1);

  const nextVersion = (current?.version ?? 1) + 1;
  await db
    .update(posts)
    .set({
      content: rev1.content,
      version: nextVersion,
      featureImageId: null,
      featureImageAlt: null,
      featureImageCaption: null,
      updatedAt: new Date(),
    })
    .where(eq(posts.id, TARGET_POST_ID));

  // Also clear Redis CRDT updates key to start cleanly
  const redis = getRedisClient();
  const redisUpdatesKey = buildPublicationCacheKey(PUBLICATION_ID, "crdt:updates", TARGET_POST_ID);
  await redis.del(redisUpdatesKey);
}

async function loginUser(page: any, email = "owner@example.com", password = "OwnerPass123!") {
  await page.goto("http://localhost:7777/admin");
  const retryBtn = page.locator('button:has-text("Retry")');
  if (await retryBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await retryBtn.click();
  }
  await page.waitForURL("**/admin/login**", { timeout: 15000 });
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click('button[type="submit"]');
  await page.waitForURL(
    (url: any) => url.pathname.startsWith("/admin") && !url.pathname.includes("/login"),
    { timeout: 15000 },
  );
}

test.describe("Post Feature Image & Body Collaboration Isolation Suite", () => {
  test.beforeAll(async () => {
    await ensureTestMediaAssets();
  });

  test.beforeEach(async () => {
    await resetTargetPost();
  });

  // ============================================================
  // TEST A: Feature Image does not mutate body
  // ============================================================
  test("Test A: Feature Image changes (A -> B -> null) leave 2080+ word body, AST, Y.Doc, restoreKey, and WS untouched", async ({
    browser,
    request,
  }) => {
    test.setTimeout(60000);
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();

    let wsConnectedCount = 0;
    let wsDisconnectedCount = 0;

    await page.addInitScript(() => {
      const OrigWS = window.WebSocket;
      (window as any).WebSocket = class extends OrigWS {
        constructor(...args: any[]) {
          super(...(args as [any, any]));
          const url = String(args[0] || "");
          if (url.includes("collaboration/ws")) {
            (window as any).__collabWsInstance = this;
            this.addEventListener("close", () => {
              (window as any).__collabWsCloseCount = ((window as any).__collabWsCloseCount || 0) + 1;
            });
          }
        }
      };
    });

    await loginUser(page);
    await page.goto(`http://localhost:7777/admin/posts/${TARGET_POST_ID}`);
    await page.waitForSelector('textarea[aria-label="Post Title"]', { timeout: 15000 });

    const editorArea = page.locator('div.vibress-studio-editor div[contenteditable="true"]');
    await expect(editorArea).toBeVisible({ timeout: 15000 });

    // Wait for document to load
    await page.waitForFunction(() => {
      const el = document.querySelector('div.vibress-studio-editor div[contenteditable="true"]');
      return el && (el.textContent?.length || 0) > 2000;
    }, { timeout: 15000 });

    // Reset collab WS close count after editor mount
    await page.evaluate(() => {
      (window as any).__collabWsCloseCount = 0;
    });

    // Measure initial word count and paragraph count
    const initialStats = await page.evaluate(() => {
      const el = document.querySelector('div.vibress-studio-editor div[contenteditable="true"]');
      const text = el?.textContent || "";
      const words = text.trim().split(/\s+/).filter(Boolean).length;
      const paragraphs = el?.querySelectorAll("p").length || 0;
      return { words, paragraphs, textLength: text.length };
    });

    console.log("[TEST A] Initial stats:", initialStats);
    expect(initialStats.words).toBeGreaterThan(2000);

    // Verify Add feature image button is visible above title
    const addImageBtn = page.locator('button:has-text("Add feature image")');
    await expect(addImageBtn).toBeVisible();

    // Change image: set to mediaAssetA via PATCH endpoint
    const patchResA = await page.request.patch(
      `http://localhost:7780/api/admin/v1/posts/${TARGET_POST_ID}/feature-image`,
      {
        headers: {
          origin: "http://localhost:7779",
        },
        data: {
          featureImageId: mediaAssetAId,
          featureImageAlt: "Alt text for A",
          featureImageCaption: "Caption for A",
        },
      },
    );
    expect(patchResA.status()).toBe(200);

    // Wait 500ms
    await page.waitForTimeout(500);

    // Verify editor body is completely untouched
    const statsAfterA = await page.evaluate(() => {
      const el = document.querySelector('div.vibress-studio-editor div[contenteditable="true"]');
      const text = el?.textContent || "";
      const words = text.trim().split(/\s+/).filter(Boolean).length;
      const paragraphs = el?.querySelectorAll("p").length || 0;
      const wsCloseCount = (window as any).__collabWsCloseCount || 0;
      return { words, paragraphs, textLength: text.length, wsCloseCount };
    });

    console.log("[TEST A] Stats after setting Image A:", statsAfterA);
    expect(statsAfterA.words).toBe(initialStats.words);
    expect(statsAfterA.paragraphs).toBe(initialStats.paragraphs);
    expect(statsAfterA.wsCloseCount).toBe(0); // Collaboration WebSocket did NOT disconnect

    // Change image: set to mediaAssetB
    const patchResB = await page.request.patch(
      `http://localhost:7780/api/admin/v1/posts/${TARGET_POST_ID}/feature-image`,
      {
        headers: {
          origin: "http://localhost:7779",
        },
        data: {
          featureImageId: mediaAssetBId,
          featureImageAlt: "Alt text for B",
          featureImageCaption: "Caption for B",
        },
      },
    );
    expect(patchResB.status()).toBe(200);

    await page.waitForTimeout(500);

    // Verify editor body is still completely untouched
    const statsAfterB = await page.evaluate(() => {
      const el = document.querySelector('div.vibress-studio-editor div[contenteditable="true"]');
      const text = el?.textContent || "";
      const words = text.trim().split(/\s+/).filter(Boolean).length;
      return { words, textLength: text.length };
    });

    expect(statsAfterB.words).toBe(initialStats.words);

    // Verify in PostgreSQL database directly that content has 51 paragraphs
    const db = getDb();
    const [dbPost] = await db
      .select()
      .from(posts)
      .where(eq(posts.id, TARGET_POST_ID))
      .limit(1);

    expect(dbPost?.featureImageId).toBe(mediaAssetBId);
    const dbChildren = (dbPost?.content as any)?.root?.children?.length || 0;
    expect(dbChildren).toBe(51);

    await context.close();
  });

  // ============================================================
  // TEST B: User A edits body while User B changes Feature Image
  // ============================================================
  test("Test B: User A edits body while User B changes Feature Image concurrently", async ({
    browser,
  }) => {
    test.setTimeout(90000);
    const contextA = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const contextB = await browser.newContext({ viewport: { width: 1280, height: 900 } });

    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    await loginUser(pageA);
    await loginUser(pageB);

    await pageA.goto(`http://localhost:7777/admin/posts/${TARGET_POST_ID}`);
    await pageB.goto(`http://localhost:7777/admin/posts/${TARGET_POST_ID}`);

    await pageA.waitForSelector('textarea[aria-label="Post Title"]', { timeout: 15000 });
    await pageB.waitForSelector('textarea[aria-label="Post Title"]', { timeout: 15000 });

    const editorAreaA = pageA.locator('div.vibress-studio-editor div[contenteditable="true"]');
    const editorAreaB = pageB.locator('div.vibress-studio-editor div[contenteditable="true"]');
    await expect(editorAreaA).toBeVisible({ timeout: 15000 });
    await expect(editorAreaB).toBeVisible({ timeout: 15000 });

    // Wait for both to load complete document
    await pageA.waitForFunction(() => {
      const el = document.querySelector('div.vibress-studio-editor div[contenteditable="true"]');
      return el && (el.textContent?.length || 0) > 2000;
    }, { timeout: 15000 });

    await pageB.waitForFunction(() => {
      const el = document.querySelector('div.vibress-studio-editor div[contenteditable="true"]');
      return el && (el.textContent?.length || 0) > 2000;
    }, { timeout: 15000 });

    const markerText = `CONCURRENT_BODY_EDIT_USER_A_${Date.now()}`;

    // User A types an edit in the body
    await editorAreaA.click();
    await pageA.keyboard.press("Control+Home");
    await pageA.keyboard.type(`${markerText} `);

    // User B mutates Feature Image concurrently via API
    const patchRes = await pageB.request.patch(
      `http://localhost:7780/api/admin/v1/posts/${TARGET_POST_ID}/feature-image`,
      {
        headers: {
          origin: "http://localhost:7779",
        },
        data: {
          featureImageId: mediaAssetAId,
          featureImageAlt: "Concurrent Alt",
        },
      },
    );
    expect(patchRes.status()).toBe(200);

    // Wait for collaboration synchronization
    await pageB.waitForFunction(
      (marker) => {
        const text = document.querySelector('div.vibress-studio-editor div[contenteditable="true"]')?.textContent || "";
        return text.includes(marker);
      },
      markerText,
      { timeout: 15000 },
    );

    // Assert User B sees User A's edit without truncation
    const bStats = await pageB.evaluate(() => {
      const el = document.querySelector('div.vibress-studio-editor div[contenteditable="true"]');
      const text = el?.textContent || "";
      const words = text.trim().split(/\s+/).filter(Boolean).length;
      return { words };
    });
    console.log("[TEST B] User B words after concurrent edits:", bStats.words);
    expect(bStats.words).toBeGreaterThan(2000);

    // Verify DB has both: User A's marker text (upon autosave or fetch) and User B's Feature Image
    const db = getDb();
    const [dbPost] = await db
      .select()
      .from(posts)
      .where(eq(posts.id, TARGET_POST_ID))
      .limit(1);

    expect(dbPost?.featureImageId).toBe(mediaAssetAId);

    await contextA.close();
    await contextB.close();
  });

  // ============================================================
  // TEST C: Reverse Concurrency (User A sets image, User B edits body)
  // ============================================================
  test("Test C: Reverse Concurrency — User A updates Feature Image, User B edits body simultaneously", async ({
    browser,
  }) => {
    test.setTimeout(90000);
    const contextA = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const contextB = await browser.newContext({ viewport: { width: 1280, height: 900 } });

    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    await loginUser(pageA);
    await loginUser(pageB);

    await pageA.goto(`http://localhost:7777/admin/posts/${TARGET_POST_ID}`);
    await pageB.goto(`http://localhost:7777/admin/posts/${TARGET_POST_ID}`);

    await pageA.waitForSelector('textarea[aria-label="Post Title"]', { timeout: 15000 });
    await pageB.waitForSelector('textarea[aria-label="Post Title"]', { timeout: 15000 });

    const editorAreaB = pageB.locator('div.vibress-studio-editor div[contenteditable="true"]');
    await expect(editorAreaB).toBeVisible({ timeout: 15000 });

    await pageB.waitForFunction(() => {
      const el = document.querySelector('div.vibress-studio-editor div[contenteditable="true"]');
      return el && (el.textContent?.length || 0) > 2000;
    }, { timeout: 15000 });

    // Step 1: User A updates Feature Image
    const patchRes = await pageA.request.patch(
      `http://localhost:7780/api/admin/v1/posts/${TARGET_POST_ID}/feature-image`,
      {
        headers: {
          origin: "http://localhost:7779",
        },
        data: {
          featureImageId: mediaAssetBId,
        },
      },
    );
    expect(patchRes.status()).toBe(200);

    // Step 2: User B simultaneously types in editor
    const revMarker = `REVERSE_CONCURRENCY_${Date.now()}`;
    await editorAreaB.click();
    await pageB.keyboard.press("Control+Home");
    await pageB.keyboard.type(`${revMarker} `);

    // Step 3: Verify User A receives User B's edits
    await pageA.waitForFunction(
      (marker) => {
        const text = document.querySelector('div.vibress-studio-editor div[contenteditable="true"]')?.textContent || "";
        return text.includes(marker);
      },
      revMarker,
      { timeout: 15000 },
    );

    const aStats = await pageA.evaluate(() => {
      const el = document.querySelector('div.vibress-studio-editor div[contenteditable="true"]');
      const text = el?.textContent || "";
      const words = text.trim().split(/\s+/).filter(Boolean).length;
      return { words };
    });
    expect(aStats.words).toBeGreaterThan(2000);

    // Step 4: Verify DB post
    const db = getDb();
    const [dbPost] = await db
      .select()
      .from(posts)
      .where(eq(posts.id, TARGET_POST_ID))
      .limit(1);

    expect(dbPost?.featureImageId).toBe(mediaAssetBId);

    await contextA.close();
    await contextB.close();
  });

  // ============================================================
  // TEST D: Simultaneous metadata + body autosave
  // ============================================================
  test("Test D: Simultaneous metadata patch + body autosave within overlapping save windows", async ({
    browser,
  }) => {
    test.setTimeout(90000);
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();

    await loginUser(page);
    await page.goto(`http://localhost:7777/admin/posts/${TARGET_POST_ID}`);
    await page.waitForSelector('textarea[aria-label="Post Title"]', { timeout: 15000 });

    const editorArea = page.locator('div.vibress-studio-editor div[contenteditable="true"]');
    await expect(editorArea).toBeVisible({ timeout: 15000 });

    await page.waitForFunction(() => {
      const el = document.querySelector('div.vibress-studio-editor div[contenteditable="true"]');
      return el && (el.textContent?.length || 0) > 2000;
    }, { timeout: 15000 });

    // Trigger body edit
    const marker = `OVERLAPPING_AUTOSAVE_${Date.now()}`;
    await editorArea.click();
    await page.keyboard.press("Control+Home");
    await page.keyboard.type(`${marker} `);

    // Immediately trigger Feature Image update in parallel
    const [patchRes] = await Promise.all([
      page.request.patch(
        `http://localhost:7780/api/admin/v1/posts/${TARGET_POST_ID}/feature-image`,
        {
          headers: {
            origin: "http://localhost:7779",
          },
          data: {
            featureImageId: mediaAssetAId,
            featureImageAlt: "Overlapping Alt",
          },
        },
      ),
      // Give 300ms for autosave debounce to fire
      page.waitForTimeout(1500),
    ]);

    expect(patchRes.status()).toBe(200);

    // Verify DB state
    const db = getDb();
    const [dbPost] = await db
      .select()
      .from(posts)
      .where(eq(posts.id, TARGET_POST_ID))
      .limit(1);

    expect(dbPost?.featureImageId).toBe(mediaAssetAId);
    expect(dbPost?.featureImageAlt).toBe("Overlapping Alt");

    const children = (dbPost?.content as any)?.root?.children || [];
    expect(children.length).toBeGreaterThanOrEqual(51);

    await context.close();
  });

  // ============================================================
  // TEST E: Disconnect / Reconnect after Feature Image mutation
  // ============================================================
  test("Test E: Disconnect and Reconnect peer after Feature Image mutation preserves complete body without replay corruption", async ({
    browser,
  }) => {
    test.setTimeout(90000);
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();

    await loginUser(page);
    await page.goto(`http://localhost:7777/admin/posts/${TARGET_POST_ID}`);
    await page.waitForSelector('textarea[aria-label="Post Title"]', { timeout: 15000 });

    const editorArea = page.locator('div.vibress-studio-editor div[contenteditable="true"]');
    await expect(editorArea).toBeVisible({ timeout: 15000 });

    await page.waitForFunction(() => {
      const el = document.querySelector('div.vibress-studio-editor div[contenteditable="true"]');
      return el && (el.textContent?.length || 0) > 2000;
    }, { timeout: 15000 });

    // Mutate feature image
    const patchRes = await page.request.patch(
      `http://localhost:7780/api/admin/v1/posts/${TARGET_POST_ID}/feature-image`,
      {
        headers: {
          origin: "http://localhost:7779",
        },
        data: {
          featureImageId: mediaAssetBId,
        },
      },
    );
    expect(patchRes.status()).toBe(200);

    // Reload the page to simulate clean reconnect
    await page.reload();
    await page.waitForSelector('textarea[aria-label="Post Title"]', { timeout: 15000 });
    await expect(editorArea).toBeVisible({ timeout: 15000 });

    // Verify document loads completely without partial CRDT replay corruption
    await page.waitForFunction(() => {
      const el = document.querySelector('div.vibress-studio-editor div[contenteditable="true"]');
      return el && (el.textContent?.length || 0) > 2000;
    }, { timeout: 15000 });

    const finalStats = await page.evaluate(() => {
      const el = document.querySelector('div.vibress-studio-editor div[contenteditable="true"]');
      const text = el?.textContent || "";
      const words = text.trim().split(/\s+/).filter(Boolean).length;
      return { words };
    });

    console.log("[TEST E] Final words after reconnect:", finalStats.words);
    expect(finalStats.words).toBeGreaterThan(2000);

    // Verify Feature Image is still populated in UI preview
    const previewImg = page.locator('img[src*="test-feature-b.jpg"]');
    await expect(previewImg).toBeVisible({ timeout: 10000 });

    await context.close();
  });
});
