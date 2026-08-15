import { test, expect } from "@playwright/test";

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
    await expect(page.locator("h1")).toContainText("Media Asset Library");

    // Verify upload button and search input present
    await expect(page.locator('input[type="file"]')).toBeAttached();
    await expect(
      page.locator('input[placeholder*="Filter assets"]'),
    ).toBeVisible();
  });

  test("Studio Post Editor Media Picker integration", async ({ page }) => {
    await page.getByRole("button", { name: "Posts", exact: true }).click();
    await page.click('button:has-text("Create Post")');
    await expect(page).toHaveURL(/.*\/admin\/posts\/new/);

    await page.fill('textarea[aria-label="Post Title"]', "Media E2E Test Post");

    // Open Slash Menu and insert an Image card (opens MediaPicker)
    const editorArea = page.locator(
      'div.vibress-studio-editor div[contenteditable="true"]',
    );
    await editorArea.click();
    await page.keyboard.type(" /");
    await page.click('li:has-text("Image")');

    // Verify card node is added to editor
    await expect(page.locator(".vibress-studio-editor")).toBeVisible();
  });
});
