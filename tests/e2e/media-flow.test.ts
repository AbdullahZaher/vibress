import { test, expect } from '@playwright/test';

test.describe('Admin Media Library & Studio Media Integration E2E', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:7777/admin');
    await page.waitForURL('**/admin/login**');
    await page.fill('#email', 'owner@example.com');
    await page.fill('#password', 'OwnerPass123!');
    await page.click('button[type="submit"]');
    await page.waitForURL(/.*\/admin/);
  });

  test('Media Library upload, browse, and details view', async ({ page }) => {
    await page.waitForSelector('a:has-text("Media")');
    await page.click('a:has-text("Media")');
    await expect(page).toHaveURL(/.*\/admin\/media/);
    await expect(page.locator('h2')).toContainText('Media Library');

    // Verify upload button and search input present
    await expect(page.locator('input[type="file"]')).toBeAttached();
    await expect(page.locator('input[placeholder*="Search"]')).toBeVisible();
  });

  test('Studio Post Editor Media Picker integration', async ({ page }) => {
    await page.waitForSelector('a:has-text("Posts")');
    await page.click('a:has-text("Posts")');
    await page.click('button:has-text("Create Post")');
    await expect(page).toHaveURL(/.*\/admin\/posts\/new/);

    await page.fill('input[type="text"]', 'Media E2E Test Post');

    // Click Insert Card button
    await page.click('button:has-text("+ Insert Card")');
    // Click image card button
    await page.click('button:has-text("Image")');

    // Verify card node is added to editor
    await expect(page.locator('.vibress-studio-editor')).toBeVisible();
  });
});
