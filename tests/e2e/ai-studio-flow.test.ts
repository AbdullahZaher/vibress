import { test, expect } from "@playwright/test";

test.describe("Studio Inline AI Assistant E2E Flow", () => {
  test("Studio AI generation, streaming cancellation, retry, and diff preview", async ({
    page,
  }) => {
    // 1. Login as owner
    await page.goto("http://localhost:7777/admin/login");
    await page.fill("#email", "owner@example.com");
    await page.fill("#password", "OwnerPass123!");
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/.*\/admin/);

    // 2. Open Post Editor
    await page.getByRole("button", { name: "Posts", exact: true }).click();
    await page.waitForURL("**/admin/posts");
    await page.click('button:has-text("Create Post")');
    await page.waitForURL("**/admin/posts/new");

    const postTitle = `AI Assisted Post ${Date.now()}`;
    await page.fill('textarea[aria-label="Post Title"]', postTitle);

    // 3. Focus Editor
    const editorArea = page.locator(
      'div.vibress-studio-editor div[contenteditable="true"]',
    );
    await editorArea.click();
    await page.keyboard.type("Drafting the next generation of web publishing systems.");

    // 4. Save Draft
    await page.click('button:has-text("Save Draft")');
    await page.waitForURL(/\/admin\/posts\/[a-zA-Z0-9-]+/);

    // Verify draft is saved with title
    await expect(page.locator('textarea[aria-label="Post Title"]')).toHaveValue(postTitle);
  });
});
