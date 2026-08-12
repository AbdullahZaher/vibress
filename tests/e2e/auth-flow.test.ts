import { test, expect } from '@playwright/test';

test.describe('Admin Identity & Authorization E2E Flow', () => {
  test('Complete login, session, protected route and logout flow', async ({ page }) => {
    // 1. Visit /admin while logged out
    await page.goto('http://localhost:7777/admin');

    // Should redirect to /admin/login
    await page.waitForURL('**/admin/login**');
    await expect(page.locator('h1')).toContainText('Vibress');

    // 2. Fill login form
    await page.fill('#email', 'owner@example.com');
    await page.fill('#password', 'OwnerPass123!');
    await page.click('button[type="submit"]');

    // 3. Successful login should navigate to /admin
    await page.waitForURL('**/admin');
    await expect(page.locator('body')).toContainText('owner@example.com');
    await expect(page.getByRole('button', { name: 'Posts', exact: true })).toBeVisible();

    // 4. Click Logout
    await page.click('button[aria-label="Sign out"]');

    // Should redirect back to /admin/login
    await page.waitForURL('**/admin/login**');

    // 5. Protected route is inaccessible again
    await page.goto('http://localhost:7777/admin');
    await page.waitForURL('**/admin/login**');
  });
});
