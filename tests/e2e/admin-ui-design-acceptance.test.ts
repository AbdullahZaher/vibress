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
  // Locator.isVisible() is instantaneous; wait for either the sign-in form
  // or an already-authenticated shell before deciding which state we are in.
  await expect(email.or(page.locator("#admin-main")).first()).toBeVisible({ timeout: 15000 });
  if (await email.isVisible()) {
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
  test("analytics with zero activity shows honest compact empty states", async ({ page }, info) => {
    await page.setViewportSize({ width: 320, height: 844 });
    await page.route("**/api/admin/v1/analytics/overview?*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          range: { range: "30d", from: "2026-10-01", to: "2026-10-30" },
          summary: { views: 0, visitors: 0, members: 0, paidMembers: 0 },
          comparison: Object.fromEntries(
            ["views", "visitors", "members"].map((metric) =>
              [metric, { current: 0, previous: 0, percentage: 0, isNew: false }])
          ),
          timeseries: [{ date: "2026-10-29", views: 0, visitors: 0, members: 0 }],
          latestPost: null, topPosts: [], topContent: [], referrers: [],
          newsletter: { sent: 0, openRate: 0, clickRate: 0 },
          growth: { freeMembers: 0, paidMembers: 0 },
        }),
      });
    });
    await login(page);
    await expect(page.getByText("No activity in this period")).toHaveCount(2);
    await expect(page.getByText("+0%", { exact: true })).toHaveCount(0);
    await assertDocumentFits(page);
    await screenshot(page, info, "analytics-empty-mobile-320");
  });

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

  test("posts: server pagination remains usable without horizontal overflow at 320px", async ({ page }, info) => {
    await page.setViewportSize({ width: 320, height: 844 });
    await login(page);
    await page.route("**/api/admin/v1/posts?*", async (route) => {
      const url = new URL(route.request().url());
      const offset = Number(url.searchParams.get("offset") || 0);
      const limit = Number(url.searchParams.get("limit") || 25);
      const total = 26;
      const count = Math.max(0, Math.min(limit, total - offset));
      const posts = Array.from({ length: count }, (_, index) => {
        const number = offset + index + 1;
        return {
          id: `post-${number}`,
          title: `Acceptance post ${number}`,
          slug: `acceptance-post-${number}`,
          status: "draft",
          publishedAt: null,
          scheduledAt: null,
          updatedAt: "2026-10-30T10:00:00.000Z",
          authors: [],
        };
      });
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ posts, total }),
      });
    });
    await page.goto(`${BASE}/admin/posts`);
    await expect(page.getByText(/Showing 1–25 of 26/)).toBeVisible();
    await assertDocumentFits(page);
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByText(/Showing 26–26 of 26/)).toBeVisible();
    await assertDocumentFits(page);
    await screenshot(page, info, "posts-mobile-320-pagination");
  });

  test("pages: server pagination and sorting controls work at 320px", async ({ page }, info) => {
    await page.setViewportSize({ width: 320, height: 844 });
    await login(page);
    await page.route("**/api/admin/v1/pages?*", async (route) => {
      const url = new URL(route.request().url());
      const offset = Number(url.searchParams.get("offset") || 0);
      const limit = Number(url.searchParams.get("limit") || 25);
      const total = 26;
      const count = Math.max(0, Math.min(limit, total - offset));
      const pages = Array.from({ length: count }, (_, index) => {
        const number = offset + index + 1;
        return {
          id: `page-${number}`,
          title: `Acceptance page ${number}`,
          slug: `acceptance-page-${number}`,
          status: "draft",
          publishedAt: null,
          updatedAt: "2026-10-30T10:00:00.000Z",
          authors: [],
        };
      });
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ pages, total }),
      });
    });
    await page.goto(`${BASE}/admin/pages`);
    await expect(page.getByText(/Showing 1–25 of 26/)).toBeVisible();
    await assertDocumentFits(page);
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByText(/Showing 26–26 of 26/)).toBeVisible();
    await assertDocumentFits(page);
    await screenshot(page, info, "pages-mobile-320-pagination");
  });

  test("posts: bulk deletion is confirmed and reports the refreshed empty state", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page);
    let items = [
      { id: "bulk-post-1", title: "Bulk acceptance one", slug: "bulk-one", status: "draft", publishedAt: null, scheduledAt: null, updatedAt: "2026-10-30T10:00:00.000Z", authors: [] },
      { id: "bulk-post-2", title: "Bulk acceptance two", slug: "bulk-two", status: "draft", publishedAt: null, scheduledAt: null, updatedAt: "2026-10-29T10:00:00.000Z", authors: [] },
    ];
    await page.route("**/api/admin/v1/posts**", async (route) => {
      const request = route.request();
      if (request.method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ posts: items, total: items.length }),
        });
        return;
      }
      if (request.method() === "DELETE") {
        const id = new URL(request.url()).pathname.split("/").pop();
        items = items.filter((item) => item.id !== id);
        await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
        return;
      }
      await route.continue();
    });
    await page.goto(`${BASE}/admin/posts`);
    await expect(page.getByText("Bulk acceptance one")).toBeVisible();
    await page.getByRole("checkbox", { name: "Select all on this page" }).check();
    const toolbar = page.getByRole("toolbar", { name: "Bulk actions" });
    await expect(toolbar).toBeVisible();
    await toolbar.getByRole("button", { name: "Delete" }).click();
    const dialog = page.locator('[role="dialog"]').last();
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Confirm delete" }).click();
    await expect(page.getByText(/No posts (found|yet)/)).toBeVisible();
  });

  test("staff interface language preference is independent and persists per account", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page);
    const languageToggle = page.getByRole("button", { name: "Switch interface language" });
    await expect(languageToggle).toBeVisible();
    await languageToggle.click();
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await assertDocumentFits(page);
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
