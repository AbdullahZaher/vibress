import { test, expect } from '@playwright/test';

test.describe('Vibress Foundation Smoke Tests', () => {
  test('Gateway serves Web App', async ({ page }) => {
    await page.goto('http://localhost:7777');
    await expect(page.locator('body')).toContainText('Vibress');
  });

  test('Gateway serves Admin App', async ({ page }) => {
    await page.goto('http://localhost:7777/admin');
    await expect(page.locator('h1')).toContainText('Vibress');
  });

  test('Gateway serves Portal App', async ({ page }) => {
    await page.goto('http://localhost:7777/portal');
    await expect(page.locator('h1')).toContainText('Vibress');
  });

  test('Gateway serves API Health', async ({ request }) => {
    const response = await request.get('http://localhost:7777/api/health/live');
    expect(response.ok()).toBeTruthy();
    const json = await response.json();
    expect(json.status).toBe('ok');
  });
});
