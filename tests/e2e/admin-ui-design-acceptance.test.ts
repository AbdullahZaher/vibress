import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page, type TestInfo } from "@playwright/test";

function getAxeSource(): string {
  try {
    const directResolved = require.resolve("axe-core/axe.min.js");
    if (fs.existsSync(directResolved)) return fs.readFileSync(directResolved, "utf-8");
  } catch {
    // Fallback to pnpm resolution paths
  }
  const direct = path.resolve(process.cwd(), "node_modules/.pnpm/axe-core@4.13.0/node_modules/axe-core/axe.min.js");
  if (fs.existsSync(direct)) return fs.readFileSync(direct, "utf-8");
  const pnpmDir = path.resolve(process.cwd(), "node_modules/.pnpm");
  if (fs.existsSync(pnpmDir)) {
    const entries = fs.readdirSync(pnpmDir);
    for (const entry of entries) {
      if (entry.startsWith("axe-core@")) {
        const candidate = path.join(pnpmDir, entry, "node_modules/axe-core/axe.min.js");
        if (fs.existsSync(candidate)) return fs.readFileSync(candidate, "utf-8");
      }
    }
  }
  throw new Error("axe-core/axe.min.js not found in node_modules");
}

async function assertZeroAxeViolations(page: Page, contextName: string, contextSelector = "#admin-main") {
  const axeSource = getAxeSource();
  await page.evaluate(axeSource);
  const results = await page.evaluate(async (selector) => {
    const target = document.querySelector(selector) || document;
    // @ts-expect-error window.axe injected dynamically
    return await window.axe.run(target, {
      runOnly: {
        type: "tag",
        values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"],
      },
    });
  }, contextSelector);

  const violations = results.violations;
  expect(violations, `WCAG violations in ${contextName}: ${JSON.stringify(violations, null, 2)}`).toHaveLength(0);
}

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
    // Default mode: Selection mode is OFF; no row checkboxes and no "Select all" row are rendered
    await expect(page.getByRole("checkbox", { name: "Select all on this page" })).toHaveCount(0);
    await expect(page.locator('[role="listitem"] input[type="checkbox"]')).toHaveCount(0);
    // Explicit entry: click Select button to enter selection mode
    const selectBtn = page.getByRole("button", { name: "Select", exact: true });
    await expect(selectBtn).toHaveAttribute("aria-pressed", "false");
    await selectBtn.click();
    await expect(page.getByRole("checkbox", { name: "Select all on this page" })).toBeVisible();
    await expect(page.locator('[role="listitem"] input[type="checkbox"]').first()).toBeVisible();
    // In selection mode, button transitions to "Done" with aria-pressed="true"
    const doneBtn = page.getByRole("button", { name: "Done", exact: true });
    await expect(doneBtn).toBeVisible();
    await expect(doneBtn).toHaveAttribute("aria-pressed", "true");

    // Toggle Done off to test clean exit and layout restoration
    await doneBtn.click();
    await expect(page.getByRole("checkbox", { name: "Select all on this page" })).toHaveCount(0);
    await expect(page.locator('[role="listitem"] input[type="checkbox"]')).toHaveCount(0);
    await expect(selectBtn).toBeVisible();
    await expect(selectBtn).toHaveAttribute("aria-pressed", "false");

    // Re-enter selection mode to proceed with bulk deletion test
    await selectBtn.click();
    await expect(doneBtn).toBeVisible();
    await page.getByRole("checkbox", { name: "Select all on this page" }).check();
    const bulkGroup = page.getByRole("group", { name: "Bulk actions" });
    await expect(bulkGroup).toBeVisible();
    await bulkGroup.getByRole("button", { name: "Delete" }).click();
    const dialog = page.locator('[role="dialog"]').last();
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Confirm delete" }).click();
    await expect(page.getByText(/No posts (found|yet)/)).toBeVisible();
  });

  for (const width of [320, 390, 768, 1024, 1440]) {
    test(`posts: verified touch target geometry at ${width}px (18x18 visual box, >=44x44 target, no overlap)`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await login(page);
      const items = [
        { id: `geo-post-1`, title: "Geometry post one", slug: "geo-one", status: "published", publishedAt: "2026-10-30T10:00:00.000Z", scheduledAt: null, updatedAt: "2026-10-30T10:00:00.000Z", authors: [] },
        { id: `geo-post-2`, title: "Geometry post two", slug: "geo-two", status: "draft", publishedAt: null, scheduledAt: null, updatedAt: "2026-10-29T10:00:00.000Z", authors: [] },
      ];
      await page.route("**/api/admin/v1/posts**", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ posts: items, total: items.length }),
        });
      });
      await page.goto(`${BASE}/admin/posts`);
      await expect(page.getByText("Geometry post one")).toBeVisible();

      // Default mode: no checkboxes rendered
      await expect(page.locator('[role="listitem"] input[type="checkbox"]')).toHaveCount(0);

      // Enter selection mode
      const selectBtn = page.getByRole("button", { name: /Select|تحديد/i });
      await selectBtn.click();

      // Check row checkbox geometry
      const rowCheckbox = page.locator('[role="listitem"] input[type="checkbox"]').first();
      await expect(rowCheckbox).toBeVisible();
      const rowLabel = page.locator('[role="listitem"] label:has(input[type="checkbox"])').first();
      await expect(rowLabel).toBeVisible();

      // Measure actual bounding boxes
      const labelBox = await rowLabel.boundingBox();
      expect(labelBox).not.toBeNull();
      expect(labelBox!.width).toBeGreaterThanOrEqual(44);
      expect(labelBox!.height).toBeGreaterThanOrEqual(44);

      const visualBox = await rowCheckbox.boundingBox();
      expect(visualBox).not.toBeNull();
      expect(Math.round(visualBox!.width)).toBe(18);
      expect(Math.round(visualBox!.height)).toBe(18);

      // Verify no overlap with thumbnail container
      const thumbnail = page.locator('[role="listitem"] div[aria-hidden="true"]').first();
      const thumbBox = await thumbnail.boundingBox();
      expect(thumbBox).not.toBeNull();

      const isRtl = (await page.locator("html").getAttribute("dir")) === "rtl";
      if (!isRtl) {
        expect(labelBox!.x + labelBox!.width).toBeLessThanOrEqual(thumbBox!.x + 2);
      } else {
        expect(thumbBox!.x + thumbBox!.width).toBeLessThanOrEqual(labelBox!.x + 2);
      }
    });
  }

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

  test("accessibility: posts list achieves 0 WCAG 2.2 AA violations in default and selection modes (light & dark)", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page);

    const testPosts = [
      { id: "axe-post-1", title: "Accessibility verified post one", slug: "axe-post-1", status: "published", publishedAt: "2026-10-30T10:00:00.000Z", scheduledAt: null, updatedAt: "2026-10-30T10:00:00.000Z", authors: [] },
      { id: "axe-post-2", title: "Accessibility verified post two", slug: "axe-post-2", status: "draft", publishedAt: null, scheduledAt: null, updatedAt: "2026-10-29T10:00:00.000Z", authors: [] },
    ];
    await page.route("**/api/admin/v1/posts**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ posts: testPosts, total: testPosts.length }),
      });
    });

    await page.goto(`${BASE}/admin/posts`);
    await expect(page.getByText("Accessibility verified post one")).toBeVisible();

    // 1. Default mode in dark theme
    await assertZeroAxeViolations(page, "posts default mode (dark)");

    // 2. Selection mode in dark theme
    const selectBtn = page.getByRole("button", { name: /Select|تحديد/i });
    await selectBtn.click();
    await expect(page.getByRole("button", { name: /Done|تم/i })).toBeVisible();
    await assertZeroAxeViolations(page, "posts selection mode (dark)");

    // 3. Selection mode with item selected (bulk actions bar visible)
    const firstCheckbox = page.locator('[role="listitem"] input[type="checkbox"]').first();
    await firstCheckbox.check();
    await expect(page.getByRole("group", { name: /Bulk actions|إجراءات/i })).toBeVisible();
    await assertZeroAxeViolations(page, "posts bulk actions active (dark)");

    // 4. Switch to light theme and verify again
    const themeToggle = page.locator("aside").getByRole("button", { name: /toggle theme/i });
    await themeToggle.click();
    await expect(page.locator("html")).not.toHaveClass(/dark/);
    await page.waitForTimeout(350);
    await assertZeroAxeViolations(page, "posts selection mode (light)");
  });

  test("accessibility: pages list achieves 0 WCAG 2.2 AA violations in default and selection modes", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page);

    const testPages = [
      { id: "axe-page-1", title: "About us static page", slug: "about-us", status: "published", publishedAt: "2026-10-30T10:00:00.000Z", updatedAt: "2026-10-30T10:00:00.000Z" },
      { id: "axe-page-2", title: "Privacy policy static page", slug: "privacy", status: "draft", publishedAt: null, updatedAt: "2026-10-29T10:00:00.000Z" },
    ];
    await page.route("**/api/admin/v1/pages*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ pages: testPages, total: testPages.length }),
      });
    });

    await page.goto(`${BASE}/admin/pages`);
    await expect(page.getByText("About us static page")).toBeVisible();

    // Default mode
    await assertZeroAxeViolations(page, "pages default mode");

    // Selection mode
    const selectBtn = page.getByRole("button", { name: /Select|تحديد/i });
    await selectBtn.click();
    await expect(page.getByRole("button", { name: /Done|تم/i })).toBeVisible();
    await assertZeroAxeViolations(page, "pages selection mode");
  });

  test("interaction: debounced search immediately invalidates open confirmation dialog", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page);

    const testPosts = [
      { id: "debounce-post-1", title: "First confirmation race post", slug: "post-1", status: "published", publishedAt: "2026-10-30T10:00:00.000Z", updatedAt: "2026-10-30T10:00:00.000Z" },
      { id: "debounce-post-2", title: "Second confirmation race post", slug: "post-2", status: "draft", publishedAt: null, updatedAt: "2026-10-29T10:00:00.000Z" },
    ];
    await page.route("**/api/admin/v1/posts**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ posts: testPosts, total: testPosts.length }),
      });
    });

    await page.goto(`${BASE}/admin/posts`);
    await expect(page.getByText("First confirmation race post")).toBeVisible();

    // Open row More Actions -> Delete
    const moreBtn = page.getByRole("button", { name: /More actions: First confirmation race post/i });
    await moreBtn.click();
    const deleteBtn = page.getByRole("menuitem", { name: /Delete/i });
    await deleteBtn.click();

    // Confirmation dialog is open
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // Type into search input
    const searchInput = page.getByRole("searchbox", { name: /Search posts/i });
    await searchInput.pressSequentially("breaking");

    // Dialog must immediately close without waiting for debounce timeout
    await expect(dialog).toHaveCount(0);
  });

  test("accessibility: portaled confirmation dialogs achieve 0 WCAG 2.2 AA violations across actions and themes", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page);

    const testPosts = [
      { id: "dialog-post-1", title: "Dialog accessibility post one", slug: "post-1", status: "published", publishedAt: "2026-10-30T10:00:00.000Z", updatedAt: "2026-10-30T10:00:00.000Z" },
      { id: "dialog-post-2", title: "Dialog accessibility post two", slug: "post-2", status: "draft", publishedAt: null, updatedAt: "2026-10-29T10:00:00.000Z" },
    ];
    await page.route("**/api/admin/v1/posts**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ posts: testPosts, total: testPosts.length }),
      });
    });

    await page.goto(`${BASE}/admin/posts`);
    await expect(page.getByText("Dialog accessibility post one")).toBeVisible();

    // 1. Single delete confirmation dialog (dark mode)
    const moreBtn = page.getByRole("button", { name: /More actions: Dialog accessibility post one/i });
    await moreBtn.click();
    await page.getByRole("menuitem", { name: /Delete/i }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await page.waitForTimeout(200);
    await assertZeroAxeViolations(page, "single delete dialog (dark)", '[role="dialog"]');

    // 2. Single delete dialog in light theme
    const cancelBtn = dialog.getByRole("button", { name: /Cancel|إلغاء/i });
    await cancelBtn.click();
    await expect(dialog).toHaveCount(0);

    const themeToggle = page.locator("aside").getByRole("button", { name: /toggle theme/i });
    await themeToggle.click();
    await expect(page.locator("html")).not.toHaveClass(/dark/);
    await page.waitForTimeout(350);

    await moreBtn.click();
    await page.getByRole("menuitem", { name: /Delete/i }).click();
    await expect(dialog).toBeVisible();
    await page.waitForTimeout(200);
    await assertZeroAxeViolations(page, "single delete dialog (light)", '[role="dialog"]');

    await dialog.getByRole("button", { name: /Cancel|إلغاء/i }).click();
    await expect(dialog).toHaveCount(0);

    // Switch back to dark theme
    await themeToggle.click();
    await expect(page.locator("html")).toHaveClass(/dark/);
    await page.waitForTimeout(350);

    // 3. Enter selection mode and test Bulk Delete dialog
    const selectBtn = page.getByRole("button", { name: /Select|تحديد/i });
    await selectBtn.click();
    await expect(page.getByRole("button", { name: /Done|تم/i })).toBeVisible();

    const firstCheckbox = page.locator('[role="listitem"] input[type="checkbox"]').first();
    await firstCheckbox.check();
    const secondCheckbox = page.locator('[role="listitem"] input[type="checkbox"]').nth(1);
    await secondCheckbox.check();

    const bulkDeleteBtn = page.getByRole("group", { name: /Bulk actions|إجراءات/i }).getByRole("button", { name: /Delete|حذف/i });
    await bulkDeleteBtn.click();
    await expect(dialog).toBeVisible();
    await page.waitForTimeout(200);
    await assertZeroAxeViolations(page, "bulk delete dialog (dark)", '[role="dialog"]');
    await dialog.getByRole("button", { name: /Cancel|إلغاء/i }).click();
    await expect(dialog).toHaveCount(0);

    // 4. Bulk Publish dialog (post-2 is draft)
    await firstCheckbox.uncheck();
    const bulkPublishBtn = page.getByRole("group", { name: /Bulk actions|إجراءات/i }).getByRole("button", { name: /Publish|نشر/i });
    await bulkPublishBtn.click();
    await expect(dialog).toBeVisible();
    await page.waitForTimeout(200);
    await assertZeroAxeViolations(page, "bulk publish dialog (dark)", '[role="dialog"]');
    await dialog.getByRole("button", { name: /Cancel|إلغاء/i }).click();
    await expect(dialog).toHaveCount(0);

    // 5. Bulk Unpublish dialog (post-1 is published)
    await secondCheckbox.uncheck();
    await firstCheckbox.check();
    const bulkUnpublishBtn = page.getByRole("group", { name: /Bulk actions|إجراءات/i }).getByRole("button", { name: /Unpublish|إلغاء النشر/i });
    await bulkUnpublishBtn.click();
    await expect(dialog).toBeVisible();
    await page.waitForTimeout(200);
    await assertZeroAxeViolations(page, "bulk unpublish dialog (dark)", '[role="dialog"]');
    await dialog.getByRole("button", { name: /Cancel|إلغاء/i }).click();
    await expect(dialog).toHaveCount(0);
  });

  test("dialog lifecycle: cancellation via Escape, Cancel, and Close buttons with focus restoration", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page);

    const testPosts = [
      { id: "cancel-post-1", title: "Cancelable dialog test post", slug: "post-1", status: "published", publishedAt: "2026-10-30T10:00:00.000Z", updatedAt: "2026-10-30T10:00:00.000Z" },
    ];
    await page.route("**/api/admin/v1/posts**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ posts: testPosts, total: testPosts.length }),
      });
    });

    await page.goto(`${BASE}/admin/posts`);
    await expect(page.getByText("Cancelable dialog test post")).toBeVisible();

    const moreBtn = page.getByRole("button", { name: /More actions: Cancelable dialog test post/i });
    const dialog = page.getByRole("dialog");

    // 1. Cancel via Escape key
    await moreBtn.click();
    await page.getByRole("menuitem", { name: /Delete/i }).click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(moreBtn).toBeFocused();

    // 2. Cancel via Cancel button
    await moreBtn.click();
    await page.getByRole("menuitem", { name: /Delete/i }).click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: /Cancel|إلغاء/i }).click();
    await expect(dialog).toHaveCount(0);
    await expect(moreBtn).toBeFocused();

    // 3. Cancel via Close (X) button
    await moreBtn.click();
    await page.getByRole("menuitem", { name: /Delete/i }).click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: /Close dialog|إغلاق النافذة/i }).click();
    await expect(dialog).toHaveCount(0);
    await expect(moreBtn).toBeFocused();
  });

  test("dialog lifecycle: keyboard focus trapping with Tab and Shift+Tab", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page);

    const testPosts = [
      { id: "trap-post-1", title: "Focus trapping test post", slug: "post-1", status: "published", publishedAt: "2026-10-30T10:00:00.000Z", updatedAt: "2026-10-30T10:00:00.000Z" },
    ];
    await page.route("**/api/admin/v1/posts**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ posts: testPosts, total: testPosts.length }),
      });
    });

    await page.goto(`${BASE}/admin/posts`);
    await expect(page.getByText("Focus trapping test post")).toBeVisible();

    const moreBtn = page.getByRole("button", { name: /More actions: Focus trapping test post/i });
    await moreBtn.click();
    await page.getByRole("menuitem", { name: /Delete/i }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    const closeBtn = dialog.getByRole("button", { name: /Close dialog|إغلاق النافذة/i });
    const confirmBtn = dialog.getByRole("button", { name: /Confirm delete|تأكيد الحذف/i });

    // Focus starts inside dialog; press Tab to move into first focusable control
    await page.keyboard.press("Tab");
    const isInsideDialog = await page.evaluate(() => {
      const active = document.activeElement;
      const dlg = document.querySelector('[role="dialog"]');
      return dlg?.contains(active) ?? false;
    });
    expect(isInsideDialog).toBe(true);

    // Focus last button (confirmBtn) and press Tab -> should wrap to closeBtn
    await confirmBtn.focus();
    await expect(confirmBtn).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(closeBtn).toBeFocused();

    // From closeBtn, press Shift+Tab -> should wrap back to confirmBtn
    await page.keyboard.press("Shift+Tab");
    await expect(confirmBtn).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  });

  test("accessibility: Arabic RTL posts editorial selection and portaled dialog", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.route("**/api/admin/v1/locales/context", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "cache-control": "no-store" },
        body: JSON.stringify({ primaryLocale: "ar", enabledLocales: ["en", "ar"] }),
      }),
    );
    await login(page);

    const testPosts = [
      { id: "ar-post-1", title: "مقال تجريبي باللغة العربية", slug: "arabic-post-1", status: "published", publishedAt: "2026-10-30T10:00:00.000Z", updatedAt: "2026-10-30T10:00:00.000Z" },
      { id: "ar-post-2", title: "مسودة مقال باللغة العربية", slug: "arabic-post-2", status: "draft", publishedAt: null, updatedAt: "2026-10-29T10:00:00.000Z" },
    ];
    await page.route("**/api/admin/v1/posts**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ posts: testPosts, total: testPosts.length }),
      });
    });

    await page.goto(`${BASE}/admin/posts`);
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByText("مقال تجريبي باللغة العربية")).toBeVisible();

    // 1. Audit RTL default mode
    await assertZeroAxeViolations(page, "arabic rtl posts default mode");

    // 2. Audit RTL selection mode
    const selectBtn = page.getByRole("button", { name: /تحديد/i });
    await selectBtn.click();
    await expect(page.getByRole("button", { name: /تم/i })).toBeVisible();
    await assertZeroAxeViolations(page, "arabic rtl posts selection mode");

    // 3. Audit RTL bulk action toolbar & portaled dialog
    const firstCheckbox = page.locator('[role="listitem"] input[type="checkbox"]').first();
    await firstCheckbox.check();
    await expect(page.getByRole("group", { name: /إجراءات/i })).toBeVisible();

    const bulkDeleteBtn = page.getByRole("group", { name: /إجراءات/i }).getByRole("button", { name: /حذف/i });
    await bulkDeleteBtn.click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await page.waitForTimeout(200);
    await assertZeroAxeViolations(page, "arabic rtl confirmation dialog", '[role="dialog"]');

    await dialog.getByRole("button", { name: /إلغاء/i }).click();
    await expect(dialog).toHaveCount(0);
  });

  test("focus lifecycle: mutation success and failure deterministic focus management", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page);

    let postsData = [
      { id: "mut-post-1", title: "Mutation focus post one", slug: "post-1", status: "published", publishedAt: "2026-10-30T10:00:00.000Z", updatedAt: "2026-10-30T10:00:00.000Z" },
      { id: "mut-post-2", title: "Mutation focus post two", slug: "post-2", status: "draft", publishedAt: null, updatedAt: "2026-10-29T10:00:00.000Z" },
    ];
    await page.route("**/api/admin/v1/posts**", async (route) => {
      const method = route.request().method();
      const url = route.request().url();
      if (method === "DELETE") {
        postsData = postsData.filter((p) => !url.includes(p.id));
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true }) });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ posts: postsData, total: postsData.length }),
      });
    });

    await page.goto(`${BASE}/admin/posts`);
    await expect(page.getByText("Mutation focus post one")).toBeVisible();

    // 1. Delete first post -> focus should move to surviving second post row
    const moreBtn1 = page.getByRole("button", { name: /More actions: Mutation focus post one/i });
    await moreBtn1.click();
    await page.getByRole("menuitem", { name: /Delete/i }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: /Confirm delete|تأكيد الحذف/i }).click();
    await expect(dialog).toHaveCount(0);

    // Focus is on surviving item row, NOT document.body
    await expect(page.getByText("Mutation focus post one")).toHaveCount(0);
    await page.waitForFunction(() => document.activeElement !== document.body);
    const activeElementTag = await page.evaluate(() => document.activeElement?.tagName);
    expect(["A", "BUTTON", "INPUT", "DIV"]).toContain(activeElementTag);

    // 2. Delete the last remaining post -> focus should transfer to empty state action or search
    const moreBtn2 = page.getByRole("button", { name: /More actions: Mutation focus post two/i });
    await moreBtn2.click();
    await page.getByRole("menuitem", { name: /Delete/i }).click();

    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: /Confirm delete|تأكيد الحذف/i }).click();
    await expect(dialog).toHaveCount(0);

    // List is now empty
    await expect(page.getByText("No posts yet")).toBeVisible();
    await page.waitForFunction(() => document.activeElement !== document.body);
    const emptyActiveElementTag = await page.evaluate(() => document.activeElement?.tagName);
    expect(["BUTTON", "INPUT"]).toContain(emptyActiveElementTag);
  });
});
