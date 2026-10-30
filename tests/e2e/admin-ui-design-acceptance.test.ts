import { expect, test, type Page, type TestInfo } from "@playwright/test";

/**
 * Admin design acceptance: real rendered UI, not a mock or source-code snapshot.
 * Screenshots are uploaded from CI as the admin-ui-design-review artifact.
 * No mutations to publication data are performed.
 */
const BASE = "http://localhost:7777";

async function login(page: Page) {
  await page.goto(`${BASE}/admin`);
  const email = page.locator("#email");
  if (await email.isVisible({ timeout: 10000 }).catch(() => false)) {
    await email.fill("owner@example.com");
    await page.locator("#password").fill("OwnerPass123!");
    await page.locator('button[type="submit"]').click();
    await expect(email).toHaveCount(0, { timeout: 15000 });
  }
  await expect(page.locator("#admin-main")).toBeVisible({ timeout: 15000 });
}

async function screenshot(page: Page, info: TestInfo, name: string) {
  await page.screenshot({
    path: info.outputPath(`design-${name}.png`),
    animations: "disabled",
    fullPage: true,
  });
}

async function assertDocumentFits(page: Page) {
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow, "no document-level horizontal scrolling").toBeLessThanOrEqual(1);
}

test.describe("Admin UI design acceptance: visual, responsive, RTL, accessibility", () => {
  test("desktop: light/dark typography and persisted theme", async ({ page }, info) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page);
    await expect(page.locator("html")).toHaveClass(/dark/);
    await assertDocumentFits(page);
    await screenshot(page, info, "desktop-dark-1440");

    const theme = page.locator("aside").getByRole("button", { name: /toggle theme/i });
    await theme.click();
    await expect(page.locator("html")).not.toHaveClass(/dark/);
    await assertDocumentFits(page);
    await screenshot(page, info, "desktop-light-1440");
    await page.reload();
    await expect(page.locator("html")).not.toHaveClass(/dark/);
  });

  for (const width of [320, 390, 430]) {
    test(`mobile ${width}px: drawer, keyboard dismissal and no horizontal overflow`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 844 });
      await login(page);
      await assertDocumentFits(page);
      const openButton = page.locator("header button").first();
      await expect(openButton).toBeVisible();
      await openButton.click();
      const drawer = page.getByRole("dialog", { name: /navigation menu/i });
      await expect(drawer).toBeVisible();
      await expect(drawer.locator("button[data-sidebar-close]")).toBeFocused();
      await screenshot(page, info, `mobile-drawer-${width}`);
      await page.keyboard.press("Escape");
      await expect(drawer).toHaveCount(0);
      await expect(openButton).toBeFocused();
      await screenshot(page, info, `mobile-page-${width}`);
    });
  }

  test("editor 320px: save controls are reachable and toolbar wraps", async ({ page }, info) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await login(page);
    await page.goto(`${BASE}/admin/posts/new`);
    const editorHeader = page.locator("#admin-main header").first();
    await expect(editorHeader).toBeVisible({ timeout: 15000 });
    const save = editorHeader.getByRole("button", { name: /save draft|save/i });
    await expect(save).toBeVisible();
    const geometry = await editorHeader.evaluate((element) => ({
      scroll: element.scrollWidth,
      client: element.clientWidth,
    }));
    expect(geometry.scroll).toBeLessThanOrEqual(geometry.client + 1);
    await screenshot(page, info, "editor-mobile-320");
  });

  test("Arabic RTL: direction, drawer position and keyboard focus", async ({ page }, info) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route("**/api/admin/v1/locales/context", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "cache-control": "no-store" },
        body: JSON.stringify({ primaryLocale: "ar", enabledLocales: ["en", "ar"] }),
      }),
    );
    await login(page);
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await assertDocumentFits(page);
    await screenshot(page, info, "arabic-rtl-mobile-390");

    await page.locator("header button").first().click();
    const drawer = page.getByRole("dialog", { name: /قائمة التنقل|navigation menu/i });
    await expect(drawer).toBeVisible();
    await expect(drawer.locator("button[data-sidebar-close]")).toBeFocused();
    const rect = await drawer.locator("aside").boundingBox();
    expect(rect).not.toBeNull();
    expect(rect!.x + rect!.width).toBeGreaterThan(389 - 3);
    await screenshot(page, info, "arabic-rtl-drawer-390");
    await page.keyboard.press("Escape");
    await expect(drawer).toHaveCount(0);
  });
});
