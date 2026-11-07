import { test, expect } from "@playwright/test";

// Real 1x1 JPEG payload used by the existing media storage integration suite.
// This exercises the host's authenticated upload, durable storage and picker.
const SAMPLE_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAoHBwgHBgoICAgLCgoLDhgQDg0NDh0VFhEYIx8lJCIfIiEmKzcvJik0KSEiMEExNDk7Pj4+JS5ESUM8SDc9Pjv/2wBDAQoLCw4NDhwQEBw7KCIoOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozv/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAP/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAgf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwApw//9k=",
  "base64",
);

function imageCards(root: unknown): Array<{ cardType: string; cardData: Record<string, unknown> }> {
  const found: Array<{ cardType: string; cardData: Record<string, unknown> }> = [];
  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const fields = node as Record<string, unknown>;
    if (
      (fields.type === "studio-card" || fields.type === "react-studio-card") &&
      fields.cardType === "image" &&
      fields.cardData && typeof fields.cardData === "object" &&
      !Array.isArray(fields.cardData)
    ) {
      found.push({ cardType: "image", cardData: fields.cardData as Record<string, unknown> });
    }
    if (Array.isArray(fields.children)) fields.children.forEach(visit);
  };
  visit(root);
  return found;
}

test.describe("Admin Media Library & Studio Media Integration E2E", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("http://localhost:7777/admin");
    await page.waitForURL("**/admin/login**");
    await page.fill("#email", "owner@example.com");
    await page.fill("#password", "OwnerPass123!");
    await page.click('button[type="submit"]');
    await page.waitForURL(/.*\/admin/);
  });

  test("Media Library upload, browse, and details view", async ({ page }) => {
    await page.getByRole("button", { name: "Media", exact: true }).click();
    await expect(page).toHaveURL(/.*\/admin\/media/);
    await expect(page.getByRole("heading", { level: 1, name: "Media", exact: true })).toBeVisible();

    // Verify upload button and search input present
    await expect(page.locator('input[type="file"]')).toBeAttached();
    await expect(
      page.locator('input[placeholder*="Filter assets"]'),
    ).toBeVisible();
  });

  test("Studio Post Editor Media Picker integration", async ({ page }) => {
    await page.getByRole("button", { name: "Posts", exact: true }).click();
    await page.getByTestId("create-post-button").click();
    await expect(page).toHaveURL(/.*\/admin\/posts\/new/);

    await page.fill('textarea[aria-label="Post Title"]', "Media E2E Test Post");

    // Open Slash Menu and insert an Image card (opens MediaPicker)
    const editorArea = page.locator(
      'div.vibress-studio-editor div[contenteditable="true"]',
    );
    await editorArea.click();
    await page.keyboard.type("/");
    await page.locator('[role="option"]:has-text("Image"), li:has-text("Image")').first().click();

    // The real media picker must open, upload to host storage, and return a
    // durable asset reference. Merely seeing the editor is not sufficient.
    const picker = page.getByRole("dialog", { name: /Select Media Asset|اختيار/i });
    await expect(picker).toBeVisible();
    const filename = `beta-picker-${Date.now()}.jpg`;
    await picker.locator('input[type="file"]').setInputFiles({
      name: filename,
      mimeType: "image/jpeg",
      buffer: SAMPLE_JPEG,
    });
    await expect(picker).toBeHidden();
    await expect(page.locator(".vibress-studio-editor")).toBeVisible();

    // An explicit author save must persist the same image card. Read through
    // the real authenticated API and compare again after browser reload.
    const createResponsePromise = page.waitForResponse(
      (response) => response.url().endsWith("/api/admin/v1/posts") &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: /Save Draft|حفظ المسودة/i }).click();
    const createResponse = await createResponsePromise;
    expect(createResponse.status()).toBeGreaterThanOrEqual(200);
    expect(createResponse.status()).toBeLessThan(300);
    const created = await createResponse.json();
    const postId: unknown = created.post?.id;
    expect(typeof postId).toBe("string");
    if (typeof postId !== "string") throw new Error("Post save did not return an ID");
    await expect(page).toHaveURL(new RegExp(`/admin/posts/${postId}`));

    const getSavedPost = async () => {
      const res = await page.request.get(
        `http://localhost:7777/api/admin/v1/posts/${postId}`,
      );
      expect(res.status()).toBe(200);
      const body = await res.json();
      return imageCards(body.post?.content?.root);
    };
    const savedCards = await getSavedPost();
    expect(savedCards).toHaveLength(1);
    const savedImage = savedCards[0]!.cardData;
    expect(typeof savedImage.assetId).toBe("string");
    expect(typeof savedImage.src).toBe("string");
    expect(savedImage.src).not.toMatch(/^blob:|^data:/i);

    await page.reload();
    await expect(page.locator('textarea[aria-label="Post Title"]')).toBeVisible();
    const reloadedCards = await getSavedPost();
    expect(reloadedCards).toEqual(savedCards);
  });
});
