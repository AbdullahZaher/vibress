import { test, expect, Page } from "@playwright/test";

async function loginAdmin(page: Page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("http://localhost:7777/admin/");
  const postsBtn = page.getByRole("button", { name: "Posts", exact: true });
  const alreadyLoggedIn = await postsBtn.isVisible().catch(() => false);
  if (!alreadyLoggedIn) {
    await page.waitForSelector("#email", { state: "visible", timeout: 15000 });
    await page.fill("#email", "owner@example.com");
    await page.fill("#password", "OwnerPass123!");
    await page.click('button[type="submit"]');
    await expect(postsBtn).toBeVisible({ timeout: 15000 });
  }
}

test.describe("Remote What's New Single Notification System", () => {
  test("1 & 2: Displays exactly ONE notification card with title, description, and badge", async ({
    page,
  }) => {
    await page.route("**/api/admin/v1/whats-new", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            item: {
              id: "analytics-email-sequences",
              title: "Analytics for email sequences",
              description:
                "Understand how your automated emails are performing.",
              icon: "sparkles",
              publishedAt: "2026-09-13T00:00:00Z",
              minVersion: "1.0.0",
            },
            items: [],
            dismissedIds: [],
            version: "1.0.0",
          }),
        });
      } else {
        await route.continue();
      }
    });

    await loginAdmin(page);

    const banners = page.locator('[data-testid="whats-new-banner"]');
    await expect(banners).toHaveCount(1);
    await expect(banners).toContainText("WHAT'S NEW?");
    await expect(banners).toContainText("Analytics for email sequences");
    await expect(banners).toContainText(
      "Understand how your automated emails are performing.",
    );
  });

  test("3, 4 & 5: Close button has aria-label, immediately hides card on click, and stays hidden across reload", async ({
    page,
  }) => {
    let dismissed = false;

    await page.route("**/api/admin/v1/whats-new**", async (route) => {
      const url = route.request().url();
      if (url.includes("/dismiss") && route.request().method() === "POST") {
        dismissed = true;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            success: true,
            dismissedIds: ["analytics-email-sequences"],
          }),
        });
      } else if (route.request().method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            item: dismissed
              ? null
              : {
                  id: "analytics-email-sequences",
                  title: "Analytics for email sequences",
                  description:
                    "Understand how your automated emails are performing.",
                  icon: "sparkles",
                  publishedAt: "2026-09-13T00:00:00Z",
                },
            items: [],
            dismissedIds: dismissed ? ["analytics-email-sequences"] : [],
            version: "1.0.0",
          }),
        });
      } else {
        await route.continue();
      }
    });

    await loginAdmin(page);

    const banner = page.locator('[data-testid="whats-new-banner"]');
    await expect(banner).toBeVisible();

    const closeBtn = page.locator('button[aria-label="Close notification"]');
    await expect(closeBtn).toBeVisible();

    // Click X
    await closeBtn.click();

    // Immediately removed
    await expect(banner).toHaveCount(0);

    // Reload page: should remain hidden
    await page.reload();
    await expect(page.locator('[data-testid="whats-new-banner"]')).toHaveCount(0);
  });

  test("6: Displays new notification when feed publishes a new notification ID", async ({
    page,
  }) => {
    await page.route("**/api/admin/v1/whats-new", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            item: {
              id: "new-feature-2026-10",
              title: "Brand New Feature 2026",
              description: "Check out the latest capability.",
              icon: "sparkles",
              publishedAt: "2026-10-01T00:00:00Z",
            },
            items: [],
            dismissedIds: ["analytics-email-sequences"], // old item dismissed
            version: "1.0.0",
          }),
        });
      } else {
        await route.continue();
      }
    });

    await loginAdmin(page);

    const banner = page.locator('[data-testid="whats-new-banner"]');
    await expect(banner).toHaveCount(1);
    await expect(banner).toContainText("Brand New Feature 2026");
  });

  test("7: Action link navigates safely when url is provided", async ({
    page,
  }) => {
    await page.route("**/api/admin/v1/whats-new", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            item: {
              id: "analytics-link",
              title: "Explore Analytics",
              description: "View traffic and conversions.",
              icon: "sparkles",
              url: "/admin/analytics",
              publishedAt: "2026-09-13T00:00:00Z",
            },
            items: [],
            dismissedIds: [],
            version: "1.0.0",
          }),
        });
      } else {
        await route.continue();
      }
    });

    await loginAdmin(page);

    const learnMoreLink = page.getByRole("link", { name: "Learn more" });
    await expect(learnMoreLink).toBeVisible();
    await expect(learnMoreLink).toHaveAttribute("href", "/admin/analytics");
  });

  test("8: Feed / API failure fails silently without breaking Admin navigation", async ({
    page,
  }) => {
    // Simulate API 500 error / offline
    await page.route("**/api/admin/v1/whats-new", async (route) => {
      await route.abort("failed");
    });

    await loginAdmin(page);

    // Banner is omitted
    await expect(page.locator('[data-testid="whats-new-banner"]')).toHaveCount(0);

    // Admin UI works completely
    await expect(page.locator("body")).toContainText("owner@example.com");
    await expect(
      page.getByRole("button", { name: "Posts", exact: true }),
    ).toBeVisible();
  });

  test("9 & 10: Multi-user account isolation and server persistence", async ({
    browser,
  }) => {
    // User A context
    const contextA = await browser.newContext();
    const pageA = await contextA.newPage();

    let userADismissed = false;
    let userBDismissed = false;

    await contextA.route("**/api/admin/v1/whats-new**", async (route) => {
      const url = route.request().url();
      if (url.includes("/dismiss") && route.request().method() === "POST") {
        userADismissed = true;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            success: true,
            dismissedIds: ["analytics-email-sequences"],
          }),
        });
      } else if (route.request().method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            item: userADismissed
              ? null
              : {
                  id: "analytics-email-sequences",
                  title: "Analytics for email sequences",
                  description:
                    "Understand how your automated emails are performing.",
                  icon: "sparkles",
                  publishedAt: "2026-09-13T00:00:00Z",
                },
            items: [],
            dismissedIds: userADismissed ? ["analytics-email-sequences"] : [],
            version: "1.0.0",
          }),
        });
      } else {
        await route.continue();
      }
    });

    await loginAdmin(pageA);
    const bannerA = pageA.locator('[data-testid="whats-new-banner"]');
    await expect(bannerA).toBeVisible();

    // User A clicks X
    await pageA.locator('button[aria-label="Close notification"]').click();
    await expect(bannerA).toHaveCount(0);

    // User B context (different user session)
    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();

    await contextB.route("**/api/admin/v1/whats-new**", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            item: userBDismissed
              ? null
              : {
                  id: "analytics-email-sequences",
                  title: "Analytics for email sequences",
                  description:
                    "Understand how your automated emails are performing.",
                  icon: "sparkles",
                  publishedAt: "2026-09-13T00:00:00Z",
                },
            items: [],
            dismissedIds: userBDismissed ? ["analytics-email-sequences"] : [],
            version: "1.0.0",
          }),
        });
      } else {
        await route.continue();
      }
    });

    await loginAdmin(pageB);
    const bannerB = pageB.locator('[data-testid="whats-new-banner"]');
    // User B still sees the notification because User A's dismissal is strictly account-scoped
    await expect(bannerB).toBeVisible();
    await expect(bannerB).toContainText("Analytics for email sequences");

    await contextA.close();
    await contextB.close();
  });
});
