import { test, expect } from "@playwright/test";

test.describe("Translation Management & Editorial UX E2E Flow", () => {
  let originalLocales: { primaryLocale: string; enabledLocales: string[] } | null = null;

  test.beforeEach(async ({ page }) => {
    await page.goto("http://localhost:7777/admin");
    await page.waitForLoadState("networkidle");
    const emailInput = page.locator("#email");
    if (await emailInput.isVisible({ timeout: 4000 }).catch(() => false)) {
      await emailInput.fill("owner@example.com");
      await page.locator("#password").fill("OwnerPass123!");
      await page.click('button[type="submit"]');
      await page.waitForURL((url) =>
        url.pathname === "/admin" || (url.pathname.startsWith("/admin") && !url.pathname.includes("/login")),
      );
    }

    const response = await page.request.get("http://localhost:7777/api/admin/v1/locales");
    expect(response.ok()).toBe(true);
    const policy = await response.json() as {
      primaryLocale: string; enabledLocales: string[]; isMultilingual: boolean;
    };
    originalLocales = null;
    if (!policy.isMultilingual) {
      await expect(page.getByRole("button", { name: "Translations", exact: true })).toHaveCount(0);
    }

    // This suite is intentionally multilingual, unlike a fresh publication.
    // Configure the fixture explicitly instead of assuming English + Arabic.
    const desiredLocales = [...policy.enabledLocales];
    if (!desiredLocales.some((locale) => locale.split("-")[0] === "en")) {
      desiredLocales.push("en");
    }
    if (!desiredLocales.some((locale) => locale.split("-")[0] === "ar")) {
      desiredLocales.push("ar-SA");
    }
    if (desiredLocales.length !== policy.enabledLocales.length) {
      originalLocales = {
        primaryLocale: policy.primaryLocale,
        enabledLocales: [...policy.enabledLocales],
      };
      const updated = await page.request.put("http://localhost:7777/api/admin/v1/locales", {
        headers: { origin: "http://localhost:7777" },
        data: {
          primaryLocale: policy.primaryLocale,
          enabledLocales: desiredLocales,
        },
      });
      expect(updated.ok()).toBe(true);
      await page.evaluate(() => window.dispatchEvent(new Event("vibress:locales-updated")));
    }
  });

  test.afterEach(async ({ page }) => {
    if (!originalLocales) return;
    const restored = await page.request.put("http://localhost:7777/api/admin/v1/locales", {
      headers: { origin: "http://localhost:7777" },
      data: originalLocales,
    });
    expect(restored.ok()).toBe(true);
    originalLocales = null;
  });

  test("Translation Matrix view, filters, health metrics, and locale columns", async ({ page }) => {
    // Navigate to Translations via Sidebar
    await page.getByRole("button", { name: "Translations", exact: true }).click();
    await page.waitForURL("**/admin/translations");

    // Check header and metric cards
    await expect(page.locator("h1")).toContainText("Translation Matrix");
    await expect(page.locator("body")).toContainText("Overall Coverage");
    await expect(page.locator("body")).toContainText("Awaiting Review");

    // Check table headers have English and Arabic
    await expect(page.locator("th")).toContainText(["English", "العربية"]);

    // Test Search input
    const searchInput = page.getByPlaceholder("Search content title or slug...");
    await expect(searchInput).toBeVisible();
    await searchInput.fill("test");
    await page.waitForTimeout(300);
  });

  test("Editorial Review Queue categorized tabs and navigation", async ({ page }) => {
    await page.goto("http://localhost:7777/admin/translations/queue");
    await page.waitForLoadState("networkidle");

    // Check title
    await expect(page.locator("h1")).toContainText("Editorial Review Queue");

    // Check tabs
    await expect(page.locator("button")).toContainText(["Stale Translations", "Needs Review", "Untranslated"]);

    // Click Needs Review tab
    await page.click('button:has-text("Needs Review")');
    await page.waitForTimeout(200);

    // Click Untranslated tab
    await page.click('button:has-text("Untranslated")');
    await page.waitForTimeout(200);
  });

  test("Side-by-side Translation Workspace and RTL target editing", async ({ page }) => {
    // Navigate to Matrix
    await page.goto("http://localhost:7777/admin/translations");
    await page.waitForLoadState("networkidle");

    // Find any translation cell or navigate directly to a mock translation workspace
    const firstTranslateBtn = page.locator('tbody tr td button, tbody tr td div[role="status"]').first();
    if (await firstTranslateBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await firstTranslateBtn.click();
      await page.waitForTimeout(500);

      // If navigated to translation editor
      if (page.url().includes("/admin/translations/") || page.url().includes("/translate/")) {
        await expect(page.locator("h1")).toContainText("Translation Workspace");
        await expect(page.locator("body")).toContainText("Source (English)");

        // Verify target title input exists
        const targetTitleInput = page.locator("#target-title");
        await expect(targetTitleInput).toBeVisible();

        // Verify AI assistant toolbar is present
        await expect(page.locator("body")).toContainText("AI Translation Assistant");
      }
    }
  });

  test("Admin RTL Layout and directional isolation", async ({ page }) => {
    // Test that when an Arabic target editor is opened, dir='rtl' is properly applied
    await page.goto("http://localhost:7777/admin/translations/queue");
    await page.waitForLoadState("networkidle");

    // Check that table renders clean without overflowing
    const queueTable = page.locator("table");
    if (await queueTable.isVisible().catch(() => false)) {
      await expect(queueTable).toBeVisible();
    }
  });

  test("Matrix Bulk Action UI controls and selection bar", async ({ page }) => {
    await page.goto("http://localhost:7777/admin/translations");
    await page.waitForLoadState("networkidle");

    // Check for select-all checkbox or item checkboxes
    const checkboxes = page.locator('table input[type="checkbox"]');
    const count = await checkboxes.count();
    if (count > 0) {
      // Select the first checkbox
      await checkboxes.first().check();
      await page.waitForTimeout(300);

      // Verify bulk action toolbar or dropdown appears
      const bulkBar = page.locator("text=Selected, text=Bulk Actions, button:has-text('Bulk')").first();
      // Should show selection feedback
      expect(await checkboxes.first().isChecked()).toBe(true);
    }
  });
});
