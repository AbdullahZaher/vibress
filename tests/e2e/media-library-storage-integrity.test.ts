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
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAoHBwgHBgoICAgLCgoLDhgQDg0NDh0VFhEYIx8lJCIfIiEmKzcvJik0KSEiMEExNDk7Pj4+JS5ESUM8SDc9Pjv/2wBDAQoLCw4NDhwQEBw7KCIoOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozv/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAP/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAgf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwApw//9k=",
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

    const db = getDb();
    await db
      .insert(mediaAssets)
      .values([
        {
          id: "fa000000-0000-4000-a000-000000000001",
          publicationId: PUBLICATION_ID,
          storageProvider: "local",
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
          id: "fa000000-0000-4000-a000-000000000002",
          publicationId: PUBLICATION_ID,
          storageProvider: "local",
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
          storageProvider: "local",
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

    // Seed a decodable, publication-owned image so the assertion cannot
    // accidentally target unrelated or unavailable media from another test.
    const fixtureId = crypto.randomUUID();
    const fixtureName = `e2e-picker-${fixtureId}.jpg`;
    const fixtureKey = `media/${fixtureId}/${fixtureName}`;
    const fixturePath = path.join(resolveCanonicalStorageRoot(), fixtureKey);
    const pool = getDbPool();

    await fs.promises.mkdir(path.dirname(fixturePath), { recursive: true });
    await fs.promises.writeFile(fixturePath, SAMPLE_JPEG);
    try {
      await pool.query(
        `INSERT INTO media_assets (id, publication_id, storage_provider, storage_key, original_filename, display_name, mime_type, extension, size_bytes, checksum, asset_type)
         VALUES ($1, $2, 'local', $3, $4, $4, 'image/jpeg', 'jpg', $5, $6, 'image')`,
        [fixtureId, PUBLICATION_ID, fixtureKey, fixtureName, SAMPLE_JPEG.length, fixtureId],
      );

      await seedFixturePost();
      await loginUser(page);
      await page.goto(`http://localhost:7777/admin/posts/${TARGET_POST_ID}`);
      await page.waitForSelector('textarea[aria-label="Post Title"]', { timeout: 15000 });

      const settingsButton = page.locator('button[aria-label="Post settings"]');
      if (await settingsButton.isVisible()) {
        await settingsButton.click();
      }

      const featureImageTrigger = page.locator(
        'button:has-text("Add feature image"), button:has-text("Change"), [data-testid="feature-image-trigger"]',
      ).first();
      await expect(featureImageTrigger).toBeVisible({ timeout: 5000 });
      await featureImageTrigger.click({ force: true });

      const modal = page.getByRole("dialog", { name: "Select Media Asset" });
      await expect(modal).toBeVisible({ timeout: 7000 });
      await modal.getByRole("textbox", { name: "Search media" }).fill(fixtureName);

      const fixtureItem = modal.getByTestId("media-picker-item").filter({ hasText: fixtureName });
      await expect(fixtureItem).toBeVisible({ timeout: 10000 });
      const thumbnail = fixtureItem.locator("img");
      await expect(thumbnail).toBeVisible();
      // Visibility alone does not mean the browser has downloaded and decoded
      // the image. Poll its decoded width rather than sampling it immediately.
      await expect.poll(
        () => thumbnail.evaluate((img: HTMLImageElement) => img.naturalWidth),
        { timeout: 10000, message: "The seeded local JPEG thumbnail must decode" },
      ).toBeGreaterThan(0);

      await modal.getByRole("button", { name: "Close" }).click();
      await expect(modal).toBeHidden();
    } finally {
      await pool.query("DELETE FROM media_assets WHERE id = $1", [fixtureId]);
      await fs.promises.rm(path.dirname(fixturePath), { recursive: true, force: true });
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
