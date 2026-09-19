import { test, expect } from "@playwright/test";
import { getDb, posts, revisions, mediaAssets, seedFixturePost } from "@vibress/database";
import { eq } from "drizzle-orm";
import { getRedisClient, buildPublicationCacheKey } from "@vibress/cache";
import fs from "node:fs";
import path from "node:path";
import { resolveCanonicalStorageRoot } from "@vibress/storage-core";

const TARGET_POST_ID = "bb46491c-dd25-492c-a035-89745ceffd6c";
const PUBLICATION_ID = "pub_default";

let mediaAssetAId: string;
let mediaAssetBId: string;

const SAMPLE_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=",
  "base64",
);

async function ensureTestMediaAssets() {
  const storageRoot = resolveCanonicalStorageRoot();
  const fileA = path.join(storageRoot, "media", "test-feature-a.jpg");
  const fileB = path.join(storageRoot, "media", "test-feature-b.jpg");
  const fileU = path.join(storageRoot, "media", "test-unsplash.jpg");
  await fs.promises.mkdir(path.dirname(fileA), { recursive: true });
  await fs.promises.writeFile(fileA, SAMPLE_JPEG);
  await fs.promises.writeFile(fileB, SAMPLE_JPEG);
  await fs.promises.writeFile(fileU, SAMPLE_JPEG);

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
        sizeBytes: SAMPLE_JPEG.length,
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
        sizeBytes: SAMPLE_JPEG.length,
        checksum: "fakechecksum2",
        assetType: "image",
      },
      {
        id: "fa000000-0000-4000-a000-000000000088",
        publicationId: PUBLICATION_ID,
        storageKey: "media/test-unsplash.jpg",
        originalFilename: "test-unsplash.jpg",
        displayName: "Dense pine forest with misty canopy",
        mimeType: "image/jpeg",
        extension: "jpg",
        sizeBytes: SAMPLE_JPEG.length,
        checksum: "fakechecksum3",
        assetType: "image",
      },
    ])
    .onConflictDoNothing();
}

async function resetTargetPostWithMedia() {
  const db = getDb();
  let [rev1] = await db
    .select()
    .from(revisions)
    .where(eq(revisions.resourceId, TARGET_POST_ID))
    .orderBy(revisions.revisionNumber)
    .limit(1);

  if (!rev1) {
    await seedFixturePost();
    [rev1] = await db
      .select()
      .from(revisions)
      .where(eq(revisions.resourceId, TARGET_POST_ID))
      .orderBy(revisions.revisionNumber)
      .limit(1);
  }

  if (!rev1) {
    throw new Error("Revision 1 not found for target post");
  }

  const baseContent =
    typeof rev1.content === "string" ? JSON.parse(rev1.content) : rev1.content;
  const children = [...baseContent.root.children];

  // Use canonical "studio-card" persistence type for initial seeding
  const imageA = {
    type: "studio-card",
    cardType: "image",
    cardData: {
      src: "https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=800",
      alt: "Baseline Image A Alt",
      caption: "Baseline Image A Caption",
      width: "regular",
    },
    version: 1,
  };

  const imageB = {
    type: "studio-card",
    cardType: "image",
    cardData: {
      src: "https://images.unsplash.com/photo-1511497584788-87676104235f?w=800",
      alt: "Baseline Image B Alt",
      caption: "Baseline Image B Caption",
      width: "regular",
    },
    version: 1,
  };

  const videoCard = {
    type: "studio-card",
    cardType: "video",
    cardData: {
      src: "https://www.w3schools.com/html/mov_bbb.mp4",
      caption: "Baseline Video Caption",
      width: "regular",
      fileName: "mov_bbb.mp4",
    },
    version: 1,
  };

  // Insert Image A at index 5, Image B at index 15, Video at index 25
  children.splice(5, 0, imageA);
  children.splice(15, 0, imageB);
  children.splice(25, 0, videoCard);

  const newDoc = {
    ...baseContent,
    root: {
      ...baseContent.root,
      children,
    },
  };

  const [current] = await db
    .select()
    .from(posts)
    .where(eq(posts.id, TARGET_POST_ID))
    .limit(1);

  const nextVersion = (current?.version ?? 1) + 1;
  await db
    .update(posts)
    .set({
      content: newDoc,
      version: nextVersion,
      featureImageId: null,
      featureImageAlt: null,
      featureImageCaption: null,
      updatedAt: new Date(),
    })
    .where(eq(posts.id, TARGET_POST_ID));

  const redis = getRedisClient();
  const redisUpdatesKey = buildPublicationCacheKey(
    PUBLICATION_ID,
    "crdt:updates",
    TARGET_POST_ID,
  );
  await redis.del(redisUpdatesKey);
}

async function loginUser(
  page: any,
  email = "owner@example.com",
  password = "OwnerPass123!",
) {
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
    (url: any) =>
      url.pathname.startsWith("/admin") && !url.pathname.includes("/login"),
    { timeout: 15000 },
  );
}

test.describe("Vibress Studio — Unified Media Floating Toolbar Suite", () => {
  test.beforeEach(async () => {
    await ensureTestMediaAssets();
    await resetTargetPostWithMedia();
  });

  // ============================================================
  // TEST A: IMAGE CHANGE
  // ============================================================
  test("TEST A: Image Change from library in-place on 2000+ word document with surrounding media preserved", async ({
    page,
  }) => {
    test.setTimeout(60000);

    await loginUser(page);
    await page.goto(`http://localhost:7777/admin/posts/${TARGET_POST_ID}`);
    await page.waitForSelector('textarea[aria-label="Post Title"]', {
      timeout: 15000,
    });

    const editorArea = page.locator(
      'div.vibress-studio-editor div[contenteditable="true"]',
    );
    await expect(editorArea).toBeVisible({ timeout: 10000 });

    // Verify baseline word count (>= 2000 words)
    await expect
      .poll(
        async () => {
          const text = await editorArea.innerText();
          return text.split(/\s+/).filter(Boolean).length;
        },
        { timeout: 15000 },
      )
      .toBeGreaterThanOrEqual(2000);

    // Locate Image A, Image B, and Video cards
    const imageCards = page.locator('[data-studio-card="image"]');
    await expect(imageCards).toHaveCount(2);

    const videoCards = page.locator('[data-studio-card="video"]');
    await expect(videoCards).toHaveCount(1);

    const imageA = imageCards.first();
    await expect(imageA).toBeVisible();

    // Hover Image A to reveal toolbar
    await imageA.hover();
    const toolbar = imageA.locator('[data-studio-toolbar="true"]');
    await expect(toolbar).toBeVisible({ timeout: 5000 });

    // Click Change button
    const changeBtn = toolbar.locator(
      'button[title="Change image from library"]',
    );
    await expect(changeBtn).toBeVisible();
    await changeBtn.click();

    // Select Media Asset from picker
    await page.waitForSelector('h3:has-text("Select Media Asset")', {
      timeout: 8000,
    });
    const assetItems = page.locator('[data-testid="media-picker-item"]');
    await expect(assetItems.first()).toBeVisible();
    await assetItems.first().click();

    // Wait for modal close
    await page.waitForSelector('h3:has-text("Select Media Asset")', {
      state: "detached",
      timeout: 8000,
    });

    // Verify Image A was updated in place, Image B remains, Video remains
    await expect(imageCards).toHaveCount(2);
    await expect(videoCards).toHaveCount(1);

    // Verify autosave completes
    await expect(
      page.locator("header").filter({ hasText: "Saved" }),
    ).toBeVisible({ timeout: 15000 });

    // Reload page and verify persistence
    await page.reload();
    await page.waitForSelector('textarea[aria-label="Post Title"]', {
      timeout: 15000,
    });
    await expect(
      page.locator('div.vibress-studio-editor div[contenteditable="true"]'),
    ).toBeVisible();

    const reloadedImages = page.locator('[data-studio-card="image"]');
    await expect(reloadedImages).toHaveCount(2);

    const reloadedVideos = page.locator('[data-studio-card="video"]');
    await expect(reloadedVideos).toHaveCount(1);

    // Verify complete document retained
    const reloadedText = await editorArea.innerText();
    const reloadedWords = reloadedText.split(/\s+/).filter(Boolean).length;
    expect(reloadedWords).toBeGreaterThanOrEqual(2000);
  });

  // ============================================================
  // TEST B: UNSPLASH REPLACEMENT
  // ============================================================
  test("TEST B: Unsplash replacement with canonical metadata and structural preservation", async ({
    page,
  }) => {
    test.setTimeout(60000);



    // Mock Unsplash API endpoints for deterministic testing
    await page.route(
      "**/api/admin/v1/integrations/unsplash/status",
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ configured: true, accessKeyConfigured: true }),
        });
      },
    );

    await page.route(
      "**/api/admin/v1/integrations/unsplash/search*",
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            total: 1,
            totalPages: 1,
            results: [
              {
                id: "photo_test_unsplash_999",
                description: "Canonical Emerald Forest",
                altDescription: "Dense pine forest with misty canopy",
                urls: {
                  raw: "https://images.unsplash.com/photo-1511497584788-87676104235f",
                  full: "https://images.unsplash.com/photo-1511497584788-87676104235f?w=2000",
                  regular:
                    "https://images.unsplash.com/photo-1511497584788-87676104235f?w=1080",
                  small:
                    "https://images.unsplash.com/photo-1511497584788-87676104235f?w=400",
                  thumb:
                    "https://images.unsplash.com/photo-1511497584788-87676104235f?w=200",
                },
                user: {
                  name: "Forest Photographer",
                  username: "forestphoto",
                  links: { html: "https://unsplash.com/@forestphoto" },
                },
                links: {
                  downloadLocation:
                    "https://api.unsplash.com/photos/photo_test_unsplash_999/download",
                },
              },
            ],
          }),
        });
      },
    );

    await page.route(
      "**/api/admin/v1/integrations/unsplash/select",
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            success: true,
            media: {
              id: "fa000000-0000-4000-a000-000000000088",
              url: "https://images.unsplash.com/photo-1511497584788-87676104235f?w=1080",
              alt: "Dense pine forest with misty canopy",
              caption: "Photo by Forest Photographer on Unsplash",
              mimeType: "image/jpeg",
              unsplashPhotoId: "photo_test_unsplash_999",
              attribution: {
                photographerName: "Forest Photographer",
                photographerUsername: "forestphoto",
                photographerUrl: "https://unsplash.com/@forestphoto",
                unsplashUrl: "https://unsplash.com",
              },
            },
          }),
        });
      },
    );

    await loginUser(page);
    await page.goto(`http://localhost:7777/admin/posts/${TARGET_POST_ID}`);
    await page.waitForSelector('textarea[aria-label="Post Title"]', {
      timeout: 15000,
    });

    const editorArea = page.locator(
      'div.vibress-studio-editor div[contenteditable="true"]',
    );
    await expect(editorArea).toBeVisible({ timeout: 10000 });

    const imageCards = page.locator('[data-studio-card="image"]');
    await expect(imageCards.first()).toBeVisible({ timeout: 15000 });
    await expect(imageCards).toHaveCount(2);

    const imageA = imageCards.first();
    await imageA.hover();

    const toolbar = imageA.locator('[data-studio-toolbar="true"]');
    const unsplashBtn = toolbar.locator(
      'button[aria-label="Replace from Unsplash"]',
    );
    await expect(unsplashBtn).toBeVisible({ timeout: 5000 });
    await unsplashBtn.click();

    // Unsplash modal opens
    await page.waitForSelector('h2:has-text("Unsplash Photo Library")', {
      timeout: 10000,
    });

    // Select the photo
    const selectBtn = page.locator('button:has-text("Select")').first();
    await expect(selectBtn).toBeVisible({ timeout: 10000 });
    await selectBtn.click();

    // Modal closes
    await page.waitForSelector('h2:has-text("Unsplash Photo Library")', {
      state: "detached",
      timeout: 10000,
    });

    // Verify image src updated to Unsplash URL
    const updatedImg = imageA.locator("img");
    await expect(updatedImg).toHaveAttribute(
      "src",
      /photo-1511497584788-87676104235f/,
    );

    // Verify caption updated to Unsplash attribution
    await expect(imageA).toContainText("Forest Photographer");

    // Wait for autosave
    await expect(
      page.locator("header").filter({ hasText: "Saved" }),
    ).toBeVisible({ timeout: 15000 });

    // Reload and verify
    await page.reload();
    await page.waitForSelector('textarea[aria-label="Post Title"]', {
      timeout: 15000,
    });
    const reloadedImageA = page.locator('[data-studio-card="image"]').first();
    await expect(reloadedImageA.locator("img")).toHaveAttribute(
      "src",
      /photo-1511497584788-87676104235f/,
    );
    await expect(reloadedImageA).toContainText("Forest Photographer");
  });

  // ============================================================
  // TEST C: ALT / CAPTION METADATA EDITING
  // ============================================================
  test("TEST C: Alt / Caption popover editing without independent API race, persisting to Lexical", async ({
    page,
  }) => {
    test.setTimeout(60000);

    // Monitor network requests: verify NO separate toolbar save endpoint is called!
    const toolbarSaveCalls: string[] = [];
    page.on("request", (req) => {
      if (
        req.url().includes("/toolbar-save") ||
        req.url().includes("/card-metadata")
      ) {
        toolbarSaveCalls.push(req.url());
      }
    });

    await loginUser(page);
    await page.goto(`http://localhost:7777/admin/posts/${TARGET_POST_ID}`);
    await page.waitForSelector('textarea[aria-label="Post Title"]', {
      timeout: 15000,
    });

    const editorArea = page.locator(
      'div.vibress-studio-editor div[contenteditable="true"]',
    );
    await expect(editorArea).toBeVisible({ timeout: 10000 });

    const imageA = page.locator('[data-studio-card="image"]').first();
    await expect(imageA).toBeVisible({ timeout: 15000 });
    await imageA.hover();

    const toolbar = imageA.locator('[data-studio-toolbar="true"]');
    const metadataBtn = toolbar.locator(
      'button[aria-label="Edit alt text and caption"]',
    );
    await expect(metadataBtn).toBeVisible({ timeout: 5000 });
    await metadataBtn.click();

    // Popover is open
    const popover = page.locator('[data-testid="image-metadata-popover"]');
    await expect(popover).toBeVisible({ timeout: 5000 });

    const altInput = popover.locator('input[aria-label="Image alt text"]');
    const captionInput = popover.locator(
      'input[aria-label="Image editorial caption"]',
    );

    await altInput.fill("Updated Screen Reader Alt Text");
    await captionInput.fill("Updated Custom Caption Text");

    // Click Done to submit
    const doneBtn = popover.locator('button:has-text("Done")');
    await doneBtn.click();
    await expect(popover).toBeHidden({ timeout: 5000 });

    // Verify no independent save API was invoked
    expect(toolbarSaveCalls.length).toBe(0);

    // Verify card caption on page
    await expect(imageA).toContainText("Updated Custom Caption Text");

    // Wait for normal Lexical autosave
    await expect(
      page.locator("header").filter({ hasText: "Saved" }),
    ).toBeVisible({ timeout: 15000 });

    // Reload and check persisted metadata
    await page.reload();
    await page.waitForSelector('textarea[aria-label="Post Title"]', {
      timeout: 15000,
    });

    const reloadedImageA = page.locator('[data-studio-card="image"]').first();
    await expect(reloadedImageA).toContainText("Updated Custom Caption Text");
    await expect(reloadedImageA.locator("img")).toHaveAttribute(
      "alt",
      "Updated Screen Reader Alt Text",
    );
  });

  // ============================================================
  // TEST D: DELETE MEDIA
  // ============================================================
  test("TEST D: Delete media node removes only targeted card, leaving surrounding paragraphs and other media intact", async ({
    page,
  }) => {
    test.setTimeout(60000);

    await loginUser(page);
    await page.goto(`http://localhost:7777/admin/posts/${TARGET_POST_ID}`);
    await page.waitForSelector('textarea[aria-label="Post Title"]', {
      timeout: 15000,
    });

    const editorArea = page.locator(
      'div.vibress-studio-editor div[contenteditable="true"]',
    );
    await expect(editorArea).toBeVisible({ timeout: 15000 });

    const imageCards = page.locator('[data-studio-card="image"]');
    await expect(imageCards.first()).toBeVisible({ timeout: 15000 });
    await expect(imageCards).toHaveCount(2);

    const videoCards = page.locator('[data-studio-card="video"]');
    await expect(videoCards.first()).toBeVisible({ timeout: 15000 });
    await expect(videoCards).toHaveCount(1);

    const initialText = await editorArea.innerText();
    const initialWords = initialText.split(/\s+/).filter(Boolean).length;
    expect(initialWords).toBeGreaterThanOrEqual(2000);

    // Hover/click Image A and click Delete
    const imageA = imageCards.first();
    await imageA.click();

    const toolbar = imageA.locator('[data-studio-toolbar="true"]');
    const deleteBtn = toolbar.locator('button[aria-label="Remove image"]');
    await expect(deleteBtn).toBeVisible({ timeout: 5000 });
    await deleteBtn.click();

    // Verify only Image A was removed
    await expect(page.locator('[data-studio-card="image"]')).toHaveCount(1);
    await expect(page.locator('[data-studio-card="video"]')).toHaveCount(1);

    // Verify words remain >= 2000
    const textAfterDelete = await editorArea.innerText();
    const wordsAfterDelete = textAfterDelete
      .split(/\s+/)
      .filter(Boolean).length;
    expect(wordsAfterDelete).toBeGreaterThanOrEqual(2000);

    // Wait for autosave
    await expect(
      page.locator("header").filter({ hasText: "Saved" }),
    ).toBeVisible({ timeout: 15000 });

    // Reload and verify
    await page.reload();
    await page.waitForSelector('textarea[aria-label="Post Title"]', {
      timeout: 15000,
    });

    await expect(page.locator('[data-studio-card="image"]')).toHaveCount(1);
    await expect(page.locator('[data-studio-card="video"]')).toHaveCount(1);
  });

  // ============================================================
  // TEST E: TWO-USER COLLABORATION
  // ============================================================
  test("TEST E: Two concurrent users — User A updates media toolbar while User B edits text; zero truncation", async ({
    browser,
  }) => {
    test.setTimeout(90000);

    // User A context
    const contextA = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    });
    const pageA = await contextA.newPage();
    await loginUser(pageA);
    await pageA.goto(`http://localhost:7777/admin/posts/${TARGET_POST_ID}`);
    await pageA.waitForSelector('textarea[aria-label="Post Title"]', {
      timeout: 15000,
    });

    // User B context
    const contextB = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    });
    const pageB = await contextB.newPage();
    await loginUser(pageB);
    await pageB.goto(`http://localhost:7777/admin/posts/${TARGET_POST_ID}`);
    await pageB.waitForSelector('textarea[aria-label="Post Title"]', {
      timeout: 15000,
    });

    const editorAreaA = pageA.locator(
      'div.vibress-studio-editor div[contenteditable="true"]',
    );
    const editorAreaB = pageB.locator(
      'div.vibress-studio-editor div[contenteditable="true"]',
    );

    await expect(editorAreaA).toBeVisible({ timeout: 15000 });
    await expect(editorAreaB).toBeVisible({ timeout: 15000 });

    // User A: Edit Alt / Caption on Image A
    const imageA = pageA.locator('[data-studio-card="image"]').first();
    await expect(imageA).toBeVisible({ timeout: 15000 });
    await imageA.hover();
    const toolbarA = imageA.locator('[data-studio-toolbar="true"]');
    const metaBtnA = toolbarA.locator(
      'button[aria-label="Edit alt text and caption"]',
    );
    await metaBtnA.click();

    const popoverA = pageA.locator('[data-testid="image-metadata-popover"]');
    await popoverA
      .locator('input[aria-label="Image editorial caption"]')
      .fill("Collab Caption By User A");
    await popoverA.locator('button:has-text("Done")').click();

    // User B: Edit paragraph "Independent authors"
    await pageB.bringToFront();
    const targetParagraphB = editorAreaB
      .locator("p")
      .filter({ hasText: "Independent authors" })
      .first();
    await targetParagraphB.scrollIntoViewIfNeeded();
    await targetParagraphB.click();
    await pageB.keyboard.insertText(" [USER_B_COLLAB_EDIT]");

    // Verify bi-directional sync
    await expect(editorAreaA).toContainText("[USER_B_COLLAB_EDIT]", {
      timeout: 15000,
    });
    const imageB_onB = pageB.locator('[data-studio-card="image"]').first();
    await expect(imageB_onB).toContainText("Collab Caption By User A", {
      timeout: 15000,
    });

    // Wait for autosave debounce and sync
    await pageA.waitForTimeout(4000);

    // Verify word count on both is intact
    const textA = await editorAreaA.innerText();
    const wordsA = textA.split(/\s+/).filter(Boolean).length;
    expect(wordsA).toBeGreaterThanOrEqual(2000);

    // Verify persistence directly in PostgreSQL
    const db = getDb();
    const [persistedPost] = await db
      .select()
      .from(posts)
      .where(eq(posts.id, TARGET_POST_ID))
      .limit(1);
    const persistedDoc =
      typeof persistedPost.content === "string"
        ? JSON.parse(persistedPost.content)
        : persistedPost.content;
    const jsonStr = JSON.stringify(persistedDoc);
    expect(jsonStr).toContain("Collab Caption By User A");
    expect(jsonStr).toContain("[USER_B_COLLAB_EDIT]");

    await contextA.close();
    await contextB.close();
  });

  // ============================================================
  // TEST F: RAPID OPERATIONS
  // ============================================================
  test("TEST F: Rapid operations sequence (Change -> Alt -> Width -> Delete) executes reliably without races", async ({
    page,
  }) => {
    test.setTimeout(60000);

    await loginUser(page);
    await page.goto(`http://localhost:7777/admin/posts/${TARGET_POST_ID}`);
    await page.waitForSelector('textarea[aria-label="Post Title"]', {
      timeout: 15000,
    });

    const editorArea = page.locator(
      'div.vibress-studio-editor div[contenteditable="true"]',
    );
    await expect(editorArea).toBeVisible({ timeout: 15000 });

    const imageA = page.locator('[data-studio-card="image"]').first();
    await expect(imageA).toBeVisible({ timeout: 15000 });
    await imageA.hover();
    const toolbar = imageA.locator('[data-studio-toolbar="true"]');

    // 1. Alt / Caption
    const metaBtn = toolbar.locator(
      'button[aria-label="Edit alt text and caption"]',
    );
    await metaBtn.click();
    const popover = page.locator('[data-testid="image-metadata-popover"]');
    await popover
      .locator('input[aria-label="Image editorial caption"]')
      .fill("Rapid Caption 1");
    await popover.locator('button:has-text("Done")').click();

    // 2. Width layout: toggle wide
    const wideBtn = toolbar.locator('button[aria-label="Wide layout width"]');
    await wideBtn.click();

    // 3. Width layout: toggle full
    const fullBtn = toolbar.locator('button[aria-label="Full layout width"]');
    await fullBtn.click();

    // 4. Width layout: toggle regular
    const regBtn = toolbar.locator('button[aria-label="Regular layout width"]');
    await regBtn.click();

    // 5. Delete
    const deleteBtn = toolbar.locator('button[aria-label="Remove image"]');
    await deleteBtn.click();

    // Verify deletion succeeded cleanly
    await expect(page.locator('[data-studio-card="image"]')).toHaveCount(1);

    // Wait for autosave
    await expect(
      page.locator("header").filter({ hasText: "Saved" }),
    ).toBeVisible({ timeout: 15000 });
  });

  // ============================================================
  // TEST G: EXACT STRUCTURAL PRESERVATION
  // ============================================================
  test("TEST G: Exact structural preservation — root child count, types, and surrounding blocks unchanged", async ({
    page,
  }) => {
    test.setTimeout(60000);

    const db = getDb();
    const [beforePost] = await db
      .select()
      .from(posts)
      .where(eq(posts.id, TARGET_POST_ID))
      .limit(1);

    const beforeDoc =
      typeof beforePost.content === "string"
        ? JSON.parse(beforePost.content)
        : beforePost.content;
    const beforeChildCount = beforeDoc.root.children.length;
    const beforeTypes = beforeDoc.root.children.map((c: any) => c.type);

    await loginUser(page);
    await page.goto(`http://localhost:7777/admin/posts/${TARGET_POST_ID}`);
    await page.waitForSelector('textarea[aria-label="Post Title"]', {
      timeout: 15000,
    });

    const editorArea = page.locator(
      'div.vibress-studio-editor div[contenteditable="true"]',
    );
    await expect(editorArea).toBeVisible({ timeout: 15000 });

    const imageA = page.locator('[data-studio-card="image"]').first();
    await expect(imageA).toBeVisible({ timeout: 15000 });
    await imageA.hover();
    const toolbar = imageA.locator('[data-studio-toolbar="true"]');

    // Edit only metadata of Image A
    const metaBtn = toolbar.locator(
      'button[aria-label="Edit alt text and caption"]',
    );
    await metaBtn.click();
    const popover = page.locator('[data-testid="image-metadata-popover"]');
    await popover
      .locator('input[aria-label="Image alt text"]')
      .fill("Structural Test Alt");
    await popover.locator('button:has-text("Done")').click();

    await expect(
      page.locator("header").filter({ hasText: "Saved" }),
    ).toBeVisible({ timeout: 15000 });

    // Check DB persistence directly
    const [afterPost] = await db
      .select()
      .from(posts)
      .where(eq(posts.id, TARGET_POST_ID))
      .limit(1);

    const afterDoc =
      typeof afterPost.content === "string"
        ? JSON.parse(afterPost.content)
        : afterPost.content;
    const afterChildCount = afterDoc.root.children.length;
    const afterTypes = afterDoc.root.children.map((c: any) => c.type);

    // Exact structural equality
    expect(afterChildCount).toBe(beforeChildCount);
    expect(afterTypes).toEqual(beforeTypes);

    // Verify surrounding nodes (index 4 and index 6) are 100% identical in type and text
    expect(afterDoc.root.children[4].type).toBe(beforeDoc.root.children[4].type);
    expect(afterDoc.root.children[4].children[0].text).toBe(
      beforeDoc.root.children[4].children[0].text,
    );
    expect(afterDoc.root.children[6].type).toBe(beforeDoc.root.children[6].type);
    expect(afterDoc.root.children[6].children[0].text).toBe(
      beforeDoc.root.children[6].children[0].text,
    );

    // Verify only the targeted node (index 5) has the updated alt
    expect(afterDoc.root.children[5].cardData.alt).toBe("Structural Test Alt");
  });

  // ============================================================
  // TEST H: TOOLBAR HIDDEN BY DEFAULT
  // ============================================================
  test("TEST H: Toolbar hidden by default when idle (computed opacity 0, pointer-events none)", async ({
    page,
  }) => {
    test.setTimeout(60000);

    await ensureTestMediaAssets();
    await resetTargetPostWithMedia();

    await loginUser(page);
    await page.goto(`http://localhost:7777/admin/posts/${TARGET_POST_ID}`);
    await page.waitForSelector('textarea[aria-label="Post Title"]', {
      timeout: 15000,
    });

    const editorArea = page.locator(
      'div.vibress-studio-editor div[contenteditable="true"]',
    );
    await expect(editorArea).toBeVisible({ timeout: 10000 });

    const imageA = page.locator('[data-studio-card="image"]').first();
    await expect(imageA).toBeVisible({ timeout: 15000 });

    const toolbar = imageA.locator('[data-studio-toolbar="true"]');

    // Move mouse completely away to ensure no hover
    await page.mouse.move(0, 0);

    // Verify toolbar is hidden by default before hover/selection
    const styles = await toolbar.evaluate((el) => {
      const computed = window.getComputedStyle(el);
      return {
        opacity: parseFloat(computed.opacity),
        pointerEvents: computed.pointerEvents,
      };
    });

    expect(styles.opacity).toBe(0);
    expect(styles.pointerEvents).toBe("none");
  });

  // ============================================================
  // TEST I: HOVER REVEALS TOOLBAR
  // ============================================================
  test("TEST I: Hover reveals toolbar with smooth transition and interactive buttons", async ({
    page,
  }) => {
    test.setTimeout(60000);

    await ensureTestMediaAssets();
    await resetTargetPostWithMedia();

    await loginUser(page);
    await page.goto(`http://localhost:7777/admin/posts/${TARGET_POST_ID}`);
    await page.waitForSelector('textarea[aria-label="Post Title"]', {
      timeout: 15000,
    });

    const imageA = page.locator('[data-studio-card="image"]').first();
    await expect(imageA).toBeVisible({ timeout: 15000 });
    const toolbar = imageA.locator('[data-studio-toolbar="true"]');

    // Start away from media
    await page.mouse.move(0, 0);
    await expect.poll(async () => {
      return toolbar.evaluate((el) => parseFloat(window.getComputedStyle(el).opacity));
    }, { timeout: 5000 }).toBe(0);

    // Hover media card
    await imageA.hover();

    // Verify toolbar becomes visible and interactive
    await expect.poll(async () => {
      return toolbar.evaluate((el) => {
        const computed = window.getComputedStyle(el);
        return {
          opacity: parseFloat(computed.opacity),
          pointerEvents: computed.pointerEvents,
        };
      });
    }, { timeout: 5000 }).toEqual({
      opacity: 1,
      pointerEvents: "auto",
    });

    // Verify Change button and metadata button are visible and interactive
    const changeBtn = toolbar.locator(
      'button[aria-label="Change image from library"]',
    );
    const metadataBtn = toolbar.locator(
      'button[aria-label="Edit alt text and caption"]',
    );
    await expect(changeBtn).toBeVisible();
    await expect(metadataBtn).toBeVisible();

    // Move pointer from media onto toolbar itself
    await toolbar.hover();

    // Verify toolbar remains visible without flicker
    const toolbarOpacity = await toolbar.evaluate((el) =>
      parseFloat(window.getComputedStyle(el).opacity),
    );
    expect(toolbarOpacity).toBe(1);
  });

  // ============================================================
  // TEST J: LEAVING MEDIA HIDES TOOLBAR
  // ============================================================
  test("TEST J: Leaving media hides toolbar", async ({ page }) => {
    test.setTimeout(60000);

    await ensureTestMediaAssets();
    await resetTargetPostWithMedia();

    await loginUser(page);
    await page.goto(`http://localhost:7777/admin/posts/${TARGET_POST_ID}`);
    await page.waitForSelector('textarea[aria-label="Post Title"]', {
      timeout: 15000,
    });

    const imageA = page.locator('[data-studio-card="image"]').first();
    await expect(imageA).toBeVisible({ timeout: 15000 });
    const toolbar = imageA.locator('[data-studio-toolbar="true"]');

    // Hover media to reveal
    await imageA.hover();
    await expect.poll(async () => {
      return toolbar.evaluate((el) => parseFloat(window.getComputedStyle(el).opacity));
    }, { timeout: 5000 }).toBe(1);

    // Move pointer outside media interaction region
    await page.mouse.move(0, 0);

    // Verify toolbar hides
    await expect.poll(async () => {
      return toolbar.evaluate((el) => {
        const computed = window.getComputedStyle(el);
        return {
          opacity: parseFloat(computed.opacity),
          pointerEvents: computed.pointerEvents,
        };
      });
    }, { timeout: 5000 }).toEqual({
      opacity: 0,
      pointerEvents: "none",
    });
  });

  // ============================================================
  // TEST K: POPOVER KEEPS TOOLBAR VISIBLE
  // ============================================================
  test("TEST K: Metadata popover keeps toolbar visible even if pointer moves into popover", async ({
    page,
  }) => {
    test.setTimeout(60000);

    await ensureTestMediaAssets();
    await resetTargetPostWithMedia();

    await loginUser(page);
    await page.goto(`http://localhost:7777/admin/posts/${TARGET_POST_ID}`);
    await page.waitForSelector('textarea[aria-label="Post Title"]', {
      timeout: 15000,
    });

    const imageA = page.locator('[data-studio-card="image"]').first();
    await expect(imageA).toBeVisible({ timeout: 15000 });
    const toolbar = imageA.locator('[data-studio-toolbar="true"]');

    // Hover media
    await imageA.hover();
    const metadataBtn = toolbar.locator(
      'button[aria-label="Edit alt text and caption"]',
    );
    await expect(metadataBtn).toBeVisible({ timeout: 5000 });
    await metadataBtn.click();

    // Popover is open
    const popover = page.locator('[data-testid="image-metadata-popover"]');
    await expect(popover).toBeVisible({ timeout: 5000 });

    // Toolbar must remain visible while popover is open
    await expect.poll(async () => {
      return toolbar.evaluate((el) => parseFloat(window.getComputedStyle(el).opacity));
    }, { timeout: 5000 }).toBe(1);

    // Move pointer into popover
    await popover.hover();
    expect(
      await toolbar.evaluate((el) => parseFloat(window.getComputedStyle(el).opacity)),
    ).toBe(1);

    // Close popover
    const doneBtn = popover.locator('button:has-text("Done")');
    await doneBtn.click();
    await expect(popover).toBeHidden({ timeout: 5000 });

    // Move pointer outside media and clear card selection by clicking outside text
    await page.mouse.move(0, 0);
    await page
      .locator('div.vibress-studio-editor div[contenteditable="true"]')
      .click({ position: { x: 10, y: 10 } });
    await page.mouse.move(0, 0);

    // Toolbar hides
    await expect.poll(async () => {
      return toolbar.evaluate((el) => {
        const computed = window.getComputedStyle(el);
        return {
          opacity: parseFloat(computed.opacity),
          pointerEvents: computed.pointerEvents,
        };
      });
    }, { timeout: 5000 }).toEqual({
      opacity: 0,
      pointerEvents: "none",
    });
  });

  // ============================================================
  // TEST L: KEYBOARD FOCUS
  // ============================================================
  test("TEST L: Keyboard focus keeps toolbar visible without pointer hover", async ({
    page,
  }) => {
    test.setTimeout(60000);

    await ensureTestMediaAssets();
    await resetTargetPostWithMedia();

    await loginUser(page);
    await page.goto(`http://localhost:7777/admin/posts/${TARGET_POST_ID}`);
    await page.waitForSelector('textarea[aria-label="Post Title"]', {
      timeout: 15000,
    });

    const imageA = page.locator('[data-studio-card="image"]').first();
    await expect(imageA).toBeVisible({ timeout: 15000 });
    const toolbar = imageA.locator('[data-studio-toolbar="true"]');

    // Move pointer outside media
    await page.mouse.move(0, 0);

    // Focus a button inside the toolbar using keyboard focus
    const changeBtn = toolbar.locator(
      'button[aria-label="Change image from library"]',
    );
    await changeBtn.focus();

    // Verify toolbar is visible and interactive while focused
    await expect.poll(async () => {
      return toolbar.evaluate((el) => {
        const computed = window.getComputedStyle(el);
        return {
          opacity: parseFloat(computed.opacity),
          pointerEvents: computed.pointerEvents,
        };
      });
    }, { timeout: 5000 }).toEqual({
      opacity: 1,
      pointerEvents: "auto",
    });

    // Move focus away and clear card selection
    await page
      .locator('div.vibress-studio-editor div[contenteditable="true"]')
      .click({ position: { x: 10, y: 10 } });
    await page.mouse.move(0, 0);

    // Verify toolbar hides when focus leaves and no hover exists
    await expect.poll(async () => {
      return toolbar.evaluate((el) => {
        const computed = window.getComputedStyle(el);
        return {
          opacity: parseFloat(computed.opacity),
          pointerEvents: computed.pointerEvents,
        };
      });
    }, { timeout: 5000 }).toEqual({
      opacity: 0,
      pointerEvents: "none",
    });
  });

  // ============================================================
  // TEST M: TOUCH / SELECTION
  // ============================================================
  test("TEST M: Touch / selection reveals toolbar on mobile viewports without hover", async ({
    page,
  }) => {
    test.setTimeout(60000);

    // Emulate mobile touch viewport
    await page.setViewportSize({ width: 390, height: 844 });

    await ensureTestMediaAssets();
    await resetTargetPostWithMedia();

    await loginUser(page);
    await page.goto(`http://localhost:7777/admin/posts/${TARGET_POST_ID}`);
    await page.waitForSelector('textarea[aria-label="Post Title"]', {
      timeout: 15000,
    });

    const imageA = page.locator('[data-studio-card="image"]').first();
    await expect(imageA).toBeVisible({ timeout: 15000 });
    const toolbar = imageA.locator('[data-studio-toolbar="true"]');

    // Tap / select media card
    await imageA.click();

    // Toolbar becomes visible and interactive
    await expect.poll(async () => {
      return toolbar.evaluate((el) => {
        const computed = window.getComputedStyle(el);
        return {
          opacity: parseFloat(computed.opacity),
          pointerEvents: computed.pointerEvents,
        };
      });
    }, { timeout: 5000 }).toEqual({
      opacity: 1,
      pointerEvents: "auto",
    });

    // Action buttons are clickable
    const metadataBtn = toolbar.locator(
      'button[aria-label="Edit alt text and caption"]',
    );
    await expect(metadataBtn).toBeVisible();
    await metadataBtn.click();

    const popover = page.locator('[data-testid="image-metadata-popover"]');
    await expect(popover).toBeVisible({ timeout: 5000 });

    // Close popover
    await popover.locator('button:has-text("Done")').click();
    await expect(popover).toBeHidden({ timeout: 5000 });

    // Click outside to clear selection
    await page.locator('textarea[aria-label="Post Title"]').click();

    // Toolbar hides
    await expect.poll(async () => {
      return toolbar.evaluate((el) => {
        const computed = window.getComputedStyle(el);
        return {
          opacity: parseFloat(computed.opacity),
          pointerEvents: computed.pointerEvents,
        };
      });
    }, { timeout: 5000 }).toEqual({
      opacity: 0,
      pointerEvents: "none",
    });
  });
});
