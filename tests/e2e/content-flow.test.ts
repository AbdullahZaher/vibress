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
    await page.waitForSelector('a:has-text("Posts")');
    await page.click('a:has-text("Posts")');
    await page.waitForURL('**/admin/posts');
    await expect(page.locator('h2')).toContainText('Posts');

    // 3. Click Create Post
    await page.click('button:has-text("Create Post")');
    await page.waitForURL('**/admin/posts/new');

    // 4. Fill Title and Excerpt
    await page.fill('form div input[type="text"]:first-of-type', 'E2E Studio Post Title');
    await page.fill('textarea', 'E2E Excerpt summary');

    // 5. Interact with Vibress Studio Editor
    const editorArea = page.locator('div.vibress-studio-editor div[contenteditable="true"]');
    await editorArea.click();
    await page.keyboard.type('Hello from Vibress Studio E2E Editor!');

    // 6. Insert a Card via Studio Toolbar
    await page.click('button:has-text("+ Insert Card")');
    await page.click('button:has-text("Image")');

    // Close MediaPicker modal if opened
    const closeModalBtn = page.locator('button:has-text("✕")');
    if (await closeModalBtn.isVisible()) {
      await closeModalBtn.click();
    } else {
      const cancelBtn = page.locator('button:has-text("Cancel")');
      if (await cancelBtn.isVisible()) {
        await cancelBtn.click();
      }
    }

    // 7. Submit Form
    await page.locator('button[type="submit"]').scrollIntoViewIfNeeded();
    await page.click('button[type="submit"]');

    // Should navigate to post edit view /admin/posts/:id
    await page.waitForURL(/\/admin\/posts\/[a-zA-Z0-9-]+/);
    await expect(page.locator('body')).toContainText('Status: draft');

    // 9. Publish Post
    await page.click('button:has-text("Publish Now")');
    await expect(page.locator('body')).toContainText('Status: published');

    // 10. Unpublish Post
    await page.click('button:has-text("Unpublish")');
    await expect(page.locator('body')).toContainText('Status: draft');
  });

  test('Page creation with Studio editor flow', async ({ page }) => {
    await page.goto('http://localhost:7777/admin/login');
    await page.fill('#email', 'owner@example.com');
    await page.fill('#password', 'OwnerPass123!');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/.*\/admin/);

    await page.waitForSelector('a:has-text("Pages")');
    await page.click('a:has-text("Pages")');
    await page.waitForURL('**/admin/pages');

    await page.click('button:has-text("Create Page")');
    await page.waitForURL('**/admin/pages/new');

    await page.fill('form div input[type="text"]:first-of-type', 'E2E Studio Page Title');

    const editorArea = page.locator('div.vibress-studio-editor div[contenteditable="true"]');
    await editorArea.click();
    await page.keyboard.type('Content on a Studio Page');

    await page.click('button[type="submit"]');
    await page.waitForURL(/\/admin\/pages\/[a-zA-Z0-9-]+/);

    await expect(page.locator('body')).toContainText('Status: draft');
  });

  test('Tags management flow', async ({ page }) => {
    await page.goto('http://localhost:7777/admin/login');
    await page.fill('#email', 'owner@example.com');
    await page.fill('#password', 'OwnerPass123!');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/.*\/admin/);

    await page.waitForSelector('a:has-text("Tags")');
    await page.click('a:has-text("Tags")');
    await page.waitForURL('**/admin/tags');

    await page.fill('input[type="text"]', 'E2E Studio Tag');
    await page.fill('textarea', 'Tag description');
    await page.click('button[type="submit"]');

    await expect(page.locator('table')).toContainText('E2E Studio Tag');
  });
});
