import { test, expect } from '@playwright/test';

test.describe('Admin Content & Vibress Studio E2E Flow', () => {
  test('Complete Post creation, Studio editing, card insertion, publishing, and unpublishing flow', async ({ page }) => {
    // 1. Login as owner
    await page.goto('http://localhost:7777/admin/login');
    await page.fill('#email', 'owner@example.com');
    await page.fill('#password', 'OwnerPass123!');
    await page.click('button[type="submit"]');

    await expect(page).toHaveURL(/.*\/admin/);

    // 2. Navigate to Posts List
    await page.getByRole('button', { name: 'Posts', exact: true }).click();
    await page.waitForURL('**/admin/posts');
    await expect(page.locator('h1')).toContainText('Posts');

    // 3. Click Create Post
    await page.click('button:has-text("Create Post")');
    await page.waitForURL('**/admin/posts/new');

    // 4. Fill Title
    await page.fill('textarea[aria-label="Post Title"]', 'E2E Studio Post Title');

    // 5. Interact with Vibress Studio Editor
    const editorArea = page.locator('div.vibress-studio-editor div[contenteditable="true"]');
    await editorArea.click();
    await page.keyboard.type('Hello from Vibress Studio E2E Editor!');

    // 6. Insert an Image Card via Slash Menu (opens MediaPicker)
    await page.keyboard.type(' /');
    await page.click('li:has-text("Image")');
    await page.waitForSelector('h3:has-text("Select Media Asset")', { timeout: 10000 });

    // Close MediaPicker modal (card stays inserted with empty data)
    const closeModalBtn = page.locator('button[aria-label="Close"]');
    if (await closeModalBtn.isVisible()) {
      await closeModalBtn.click();
    }

    // 7. Save Draft
    await page.click('button:has-text("Save Draft")');

    // Should navigate to post edit view /admin/posts/:id
    await page.waitForURL(/\/admin\/posts\/[a-zA-Z0-9-]+/);
    await expect(page.locator('body')).toContainText('DRAFT');

    // 9. Publish Post
    await page.click('button:has-text("Publish Now")');
    await expect(page.locator('body')).toContainText('PUBLISHED');

    // 10. Unpublish Post
    await page.click('button:has-text("Unpublish")');
    await expect(page.locator('body')).toContainText('DRAFT');
  });

  test('Page creation with Studio editor flow', async ({ page }) => {
    await page.goto('http://localhost:7777/admin/login');
    await page.fill('#email', 'owner@example.com');
    await page.fill('#password', 'OwnerPass123!');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/.*\/admin/);

    await page.getByRole('button', { name: 'Pages', exact: true }).click();
    await page.waitForURL('**/admin/pages');

    await page.click('button:has-text("Create Page")');
    await page.waitForURL('**/admin/pages/new');

    await page.fill('textarea[aria-label="Page Title"]', 'E2E Studio Page Title');

    const editorArea = page.locator('div.vibress-studio-editor div[contenteditable="true"]');
    await editorArea.click();
    await page.keyboard.type('Content on a Studio Page');

    await page.click('button:has-text("Create Page")');
    await page.waitForURL(/\/admin\/pages\/[a-zA-Z0-9-]+/);

    await expect(page.locator('body')).toContainText('DRAFT');
  });

  test('Tags management flow', async ({ page }) => {
    await page.goto('http://localhost:7777/admin/login');
    await page.fill('#email', 'owner@example.com');
    await page.fill('#password', 'OwnerPass123!');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/.*\/admin/);

    await page.getByRole('button', { name: 'Tags', exact: true }).click();
    await page.waitForURL('**/admin/tags');

    await page.fill('input[placeholder="e.g. Technology"]', 'E2E Studio Tag');
    await page.fill('input[placeholder="Tag summary..."]', 'Tag description');
    await page.click('button:has-text("Create Tag")');

    await expect(page.locator('table')).toContainText('E2E Studio Tag');
  });
});
