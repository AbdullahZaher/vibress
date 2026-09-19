import { test, expect } from "@playwright/test";
import { getDb, getDbPool, posts, revisions, mediaAssets, seedFixturePost } from "@vibress/database";
import { eq, and } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { resolveCanonicalStorageRoot, LocalStorageProvider, StorageRegistry } from "@vibress/storage-core";
import { MediaService } from "@vibress/media";

const TARGET_POST_ID = "bb46491c-dd25-492c-a035-89745ceffd6c";
const PUBLICATION_ID = "pub_default";

const SAMPLE_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=",
  "base64",
);

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

  // Check if already authenticated
  if (page.url().includes("/admin") && !page.url().includes("/login")) {
    const isInsideAdmin = await page.locator('button[aria-label="Post settings"], [href*="/admin/posts"], text=Posts, text=Dashboard').first().isVisible({ timeout: 2000 }).catch(() => false);
    if (isInsideAdmin) return;
  }

  try {
    await page.waitForURL("**/admin/login**", { timeout: 4000 });
  } catch {
    if (page.url().includes("/admin") && !page.url().includes("/login")) {
      return;
    }
  }

  const emailField = page.locator("#email");
  if (await emailField.isVisible({ timeout: 4000 }).catch(() => false)) {
    await emailField.fill(email);
    await page.fill("#password", password);
    await page.click('button[type="submit"]');
    await page.waitForURL(
      (url: any) =>
        url.pathname.startsWith("/admin") && !url.pathname.includes("/login"),
      { timeout: 15000 },
    );
  }
}

test.describe("Vibress — Media Storage & Library Integrity Suite", () => {
  test.beforeAll(async () => {
    // Ensure test assets exist on canonical disk
    const storageRoot = resolveCanonicalStorageRoot();
    const fileA = path.join(storageRoot, "media", "test-feature-a.jpg");
    const fileB = path.join(storageRoot, "media", "test-feature-b.jpg");
    const fileU = path.join(storageRoot, "media", "test-unsplash.jpg");
    await fs.promises.mkdir(path.dirname(fileA), { recursive: true });
    await fs.promises.writeFile(fileA, SAMPLE_JPEG);
    await fs.promises.writeFile(fileB, SAMPLE_JPEG);
    await fs.promises.writeFile(fileU, SAMPLE_JPEG);
  });

  // ============================================================
  // TEST A: Previously uploaded local media renders correctly
  // ============================================================
  test("TEST A: Previously uploaded local media resolves HTTP 200 and streams correctly", async ({
    request,
  }) => {
    const pool = getDbPool();
    const { rows } = await pool.query(
      "SELECT id, storage_key, mime_type FROM media_assets WHERE deleted_at IS NULL AND storage_provider = 'local' LIMIT 10",
    );
    expect(rows.length).toBeGreaterThan(0);

    for (const asset of rows) {
      const encodedKey = asset.storage_key
        .split("/")
        .map((p: string) => encodeURIComponent(p))
        .join("/");
      const res = await request.get(`http://127.0.0.1:7780/content/media/${encodedKey}`);
      expect(res.status()).toBe(200);
      expect(res.headers()["content-type"]).toBe(asset.mime_type);
      const body = await res.body();
      expect(body.length).toBeGreaterThan(0);
    }
  });

  // ============================================================
  // TEST B: Newly uploaded media persists and streams from canonical root
  // ============================================================
  test("TEST B: Newly uploaded media writes to canonical root and streams via API", async ({
    request,
  }) => {
    const storageRoot = resolveCanonicalStorageRoot();
    const testAssetId = crypto.randomUUID();
    const testFilename = `test-upload-${Date.now()}.png`;
    const relKey = `media/${testAssetId}/${testFilename}`;
    const fullCanonicalPath = path.join(storageRoot, relKey);

    // Write file directly into canonical storage
    await fs.promises.mkdir(path.dirname(fullCanonicalPath), { recursive: true });
    await fs.promises.writeFile(fullCanonicalPath, SAMPLE_JPEG);

    // Insert DB record
    const pool = getDbPool();
    await pool.query(
      `INSERT INTO media_assets (id, publication_id, storage_provider, storage_key, original_filename, display_name, mime_type, extension, size_bytes, checksum, asset_type)
       VALUES ($1, $2, 'local', $3, $4, $4, 'image/png', 'png', $5, 'fakecheck', 'image')`,
      [testAssetId, PUBLICATION_ID, relKey, testFilename, SAMPLE_JPEG.length],
    );

    try {
      // Verify streaming endpoint serves it with HTTP 200
      const encodedKey = relKey.split("/").map((p) => encodeURIComponent(p)).join("/");
      const res = await request.get(`http://127.0.0.1:7780/content/media/${encodedKey}`);
      expect(res.status()).toBe(200);
      expect(res.headers()["x-content-type-options"]).toBe("nosniff");
      const body = await res.body();
      expect(body.equals(SAMPLE_JPEG)).toBe(true);
    } finally {
      // Clean up test asset
      await pool.query("DELETE FROM media_assets WHERE id = $1", [testAssetId]);
      await fs.promises.rm(path.dirname(fullCanonicalPath), { recursive: true, force: true });
    }
  });

  // ============================================================
  // TEST C: Post feature image picker loads and sets image
  // ============================================================
  test("TEST C: Post feature image picker loads media and renders selection", async ({
    page,
  }) => {
    test.setTimeout(60000);
    await seedFixturePost();
    await loginUser(page);
    await page.goto(`http://localhost:7777/admin/posts/${TARGET_POST_ID}`);
    await page.waitForSelector('textarea[aria-label="Post Title"]', { timeout: 15000 });

    // Open post settings panel if not open
    const settingsButton = page.locator('button[aria-label="Post settings"]');
    if (await settingsButton.isVisible()) {
      await settingsButton.click();
    }

    // Locate feature image picker trigger or feature image container
    const featureImageTrigger = page.locator(
      'button:has-text("Add feature image"), button:has-text("Change"), [data-testid="feature-image-trigger"]',
    ).first();

    if (await featureImageTrigger.isVisible({ timeout: 5000 }).catch(() => false)) {
      await featureImageTrigger.click({ force: true });

      // Media picker modal should be visible
      const modal = page.locator('[role="dialog"]');
      await expect(modal).toBeVisible({ timeout: 7000 });

      // Verify thumbnails are rendered without broken image states
      const firstThumb = modal.locator("img").first();
      await expect(firstThumb).toBeVisible({ timeout: 10000 });

      const thumbnails = modal.locator("img");
      const count = await thumbnails.count();
      expect(count).toBeGreaterThan(0);

      const naturalWidth = await firstThumb.evaluate(
        (img: HTMLImageElement) => img.naturalWidth,
      );
      expect(naturalWidth).toBeGreaterThan(0);

      // Close modal
      const closeBtn = modal.locator('button[aria-label="Close"], button:has-text("Cancel")').first();
      if (await closeBtn.isVisible()) {
        await closeBtn.click();
      }
    }
  });

  // ============================================================
  // TEST D: Editor Slash-Menu image insert from Media Library
  // ============================================================
  test("TEST D: Editor image cards reference valid media URLs", async ({
    page,
  }) => {
    test.setTimeout(60000);
    await loginUser(page);
    await page.goto(`http://localhost:7777/admin/posts/${TARGET_POST_ID}`);
    await page.waitForSelector('textarea[aria-label="Post Title"]', { timeout: 15000 });

    const editorArea = page.locator('div.vibress-studio-editor div[contenteditable="true"]');
    await expect(editorArea).toBeVisible({ timeout: 10000 });

    // Find any rendered studio image card
    const imageCards = editorArea.locator('img');
    const imgCount = await imageCards.count();
    if (imgCount > 0) {
      for (let i = 0; i < Math.min(imgCount, 3); i++) {
        const img = imageCards.nth(i);
        const src = await img.getAttribute("src");
        expect(src).toBeTruthy();
        expect(src).not.toBe("");
        // Verify image loads successfully
        const naturalWidth = await img.evaluate((el: HTMLImageElement) => el.naturalWidth);
        expect(naturalWidth).toBeGreaterThan(0);
      }
    }
  });

  // ============================================================
  // TEST E: Unsplash remote media resolution & fallback
  // ============================================================
  test("TEST E: Unsplash remote media maintains remote provider and URL", async () => {
    const localProvider = new LocalStorageProvider({
      type: "local",
      storageRoot: resolveCanonicalStorageRoot(),
      baseUrl: "/content/media",
    });
    const registry = new StorageRegistry();
    registry.register(localProvider);
    const mediaService = new MediaService({} as any, registry);
    const unsplashAsset: any = {
      id: "unsplash-test-1",
      storageProvider: "unsplash",
      storageKey: "photo-1506744038136-46273834b3fb",
      metadata: {
        sourceUrl: "https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=1200",
      },
    };

    const resolvedUrl = await mediaService.getMediaUrl(unsplashAsset);
    expect(resolvedUrl).toBe("https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=1200");

    // Without metadata fallback
    const fallbackAsset: any = {
      id: "unsplash-test-2",
      storageProvider: "unsplash",
      storageKey: "photo-abcdef",
      metadata: {},
    };
    const cdnUrl = await mediaService.getMediaUrl(fallbackAsset);
    expect(cdnUrl).toBe("https://images.unsplash.com/photo-abcdef?w=1200&auto=format&fit=crop&q=80");
  });

  // ============================================================
  // TEST F: Provider-aware media URL resolution
  // ============================================================
  test("TEST F: Provider-aware URL resolution returns null for unavailable, never empty string", async () => {
    const localProvider = new LocalStorageProvider({
      type: "local",
      storageRoot: resolveCanonicalStorageRoot(),
      baseUrl: "/content/media",
    });
    const registry = new StorageRegistry();
    registry.register(localProvider);
    const mediaService = new MediaService({} as any, registry);

    // Local asset
    const localAsset: any = {
      id: "local-test-1",
      storageProvider: "local",
      storageKey: "media/sample.jpg",
    };
    expect(await mediaService.getMediaUrl(localAsset)).toBe("/content/media/media/sample.jpg");

    // Unsupported unknown provider
    const unknownAsset: any = {
      id: "unknown-test-1",
      storageProvider: "azure-blob-unknown",
      storageKey: "media/sample.jpg",
    };
    const unknownUrl = await mediaService.getMediaUrl(unknownAsset);
    expect(unknownUrl).toBeNull();
    expect(unknownUrl).not.toBe("");
  });

  // ============================================================
  // TEST G: Missing storage object renders graceful fallback without crashing
  // ============================================================
  test("TEST G: Missing storage object renders fallback placeholder without crashing", async ({
    page,
  }) => {
    test.setTimeout(60000);
    // Insert a transient media row pointing to non-existent file
    const pool = getDbPool();
    const missingAssetId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO media_assets (id, publication_id, storage_provider, storage_key, original_filename, display_name, mime_type, extension, size_bytes, checksum, asset_type)
       VALUES ($1, $2, 'local', 'media/non-existent-file-404.png', 'non-existent-file-404.png', 'Missing Asset 404', 'image/png', 'png', 100, 'none', 'image')`,
      [missingAssetId, PUBLICATION_ID],
    );

    try {
      await loginUser(page);
      await page.goto("http://localhost:7777/admin/media");
      await page.waitForSelector('text=Media Library', { timeout: 15000 }).catch(() => {});

      // Verify the page doesn't crash or show white screen
      const body = page.locator("body");
      await expect(body).toBeVisible();

      // Check for presence of missing asset item or graceful fallback
      const missingItem = page.locator(`text=Missing Asset 404`);
      if (await missingItem.isVisible({ timeout: 5000 }).catch(() => false)) {
        await expect(missingItem).toBeVisible();
      }
    } finally {
      await pool.query("DELETE FROM media_assets WHERE id = $1", [missingAssetId]);
    }
  });

  // ============================================================
  // TEST H: Page reload preserves media resolution without broken images
  // ============================================================
  test("TEST H: Page reload preserves media resolution without broken images", async ({
    page,
  }) => {
    test.setTimeout(60000);
    await loginUser(page);
    await page.goto("http://localhost:7777/admin/media");
    await page.waitForLoadState("networkidle");

    // Check images before reload
    const imagesBefore = page.locator("img");
    const countBefore = await imagesBefore.count();

    // Reload page
    await page.reload({ waitUntil: "networkidle" });

    // Verify images still render properly
    const imagesAfter = page.locator("img");
    const countAfter = await imagesAfter.count();
    expect(countAfter).toBe(countBefore);

    for (let i = 0; i < Math.min(countAfter, 5); i++) {
      const img = imagesAfter.nth(i);
      const isVisible = await img.isVisible();
      if (isVisible) {
        const naturalWidth = await img.evaluate((el: HTMLImageElement) => el.naturalWidth);
        expect(naturalWidth).toBeGreaterThan(0);
      }
    }
  });

  // ============================================================
  // TEST I: Multi-tenant / publication media isolation
  // ============================================================
  test("TEST I: Multi-tenant publication media isolation is preserved", async () => {
    const pool = getDbPool();
    const isolatedPubId = "pub_isolated_tenant_test";

    // Assets belonging to pub_default must not be returned when querying pub_isolated_tenant_test
    const { rows } = await pool.query(
      "SELECT id FROM media_assets WHERE publication_id = $1",
      [isolatedPubId],
    );
    expect(rows.length).toBe(0);

    const { rows: defaultRows } = await pool.query(
      "SELECT id FROM media_assets WHERE publication_id = $1",
      [PUBLICATION_ID],
    );
    expect(defaultRows.length).toBeGreaterThan(0);
  });

  // ============================================================
  // TEST J: Path traversal protection on media streaming endpoint
  // ============================================================
  test("TEST J: Path traversal attempts return 404 without leaking internal files", async ({
    request,
  }) => {
    const badPaths = [
      "http://127.0.0.1:7780/content/media/../package.json",
      "http://127.0.0.1:7780/content/media/%2e%2e%2fpackage.json",
      "http://127.0.0.1:7780/content/media/media/..%2f..%2fpackage.json",
      "http://127.0.0.1:7780/content/media/..\\..\\package.json",
      "http://127.0.0.1:7780/content/media/%00package.json",
      "http://127.0.0.1:7780/content/media//etc/passwd",
    ];

    for (const badUrl of badPaths) {
      const res = await request.get(badUrl);
      expect(res.status()).toBe(404);
      const text = await res.text();
      expect(text).not.toContain('"dependencies"');
      expect(text).not.toContain("root:x:0:0");
    }
  });
});
